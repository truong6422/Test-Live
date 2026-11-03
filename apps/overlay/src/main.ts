import { Application } from 'pixi.js';
import type { CatchEvent, LeaderboardEntry, RosterMember, RunningAction, ServerMessage, WorkEvent } from '@cau/shared';
import { Hud } from './hud';
import { ANIMATIONS, PREVIEW_DURATIONS } from './scene/animations';
import { loadAssets } from './scene/assets';
import { Director } from './scene/director';
import { buildLake } from './scene/lake';
import './style.css';

const params = new URLSearchParams(location.search);

/** Scale sân khấu 1080×1920 vừa cửa sổ (OBS đặt đúng 1080×1920 thì scale = 1). */
function fitStage(): void {
  const stage = document.getElementById('stage')!;
  const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  stage.style.transform = `translate(${(window.innerWidth - 1080 * s) / 2}px, ${(window.innerHeight - 1920 * s) / 2}px) scale(${s})`;
}
window.addEventListener('resize', fitStage);
fitStage();

// Nhẹ máy: không khử răng cưa (pixel art không cần), độ phân giải 1, giới hạn 30 khung hình/giây.
const app = new Application();
await app.init({ width: 1080, height: 1920, antialias: false, background: 0x2b2f3a, resolution: 1, roundPixels: true });
app.ticker.maxFPS = Number(params.get('fps')) || 30;
document.getElementById('scene')!.appendChild(app.canvas);

// Ảnh tuỳ chọn (nền hồ, ảnh cá to) — thiếu thì vẽ pixel bằng code.
await loadAssets();
const scene = buildLake();
app.stage.addChild(scene.root);
const director = new Director(scene);
const hud = new Hud();

/** Bóng cá to lượn dưới hồ trong khoảng [nextBigFishAt - shadowMs, nextBigFishAt) (giờ server). */
const bigFish = { at: 0, shadowMs: 0, clockOffset: 0, active: false };
function updateShadow(): void {
  const now = Date.now() + bigFish.clockOffset;
  const on = !bigFish.active && bigFish.at > 0 && bigFish.shadowMs > 0 && now >= bigFish.at - bigFish.shadowMs && now < bigFish.at;
  scene.bigFishShadow.show(on);
}
setInterval(updateShadow, 500);

app.ticker.add((t) => director.tick(t.deltaMS));

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case 'snapshot': {
      const s = msg.data;
      director.syncClock(s.serverTime);
      bigFish.clockOffset = s.serverTime - Date.now();
      scene.anglers.sync(s.roster ?? []);
      director.reset(s.runningActions);
      director.setMood(s.king.mood);
      hud.feed(s.feed);
      hud.leaderboard(s.leaderboard, s.participants, s.kgBoard ?? []);
      hud.collective(s.collective);
      hud.connectors(s.connectors);
      hud.running(s.running);
      bigFish.at = s.nextBigFishAt ?? 0;
      bigFish.shadowMs = s.bigFishShadowMs ?? 0;
      bigFish.active = s.runningActions.some((r) => r.actionId === 'big_fish_event');
      hud.bigFishNext(bigFish.at);
      updateShadow();
      break;
    }
    case 'action.started':
      director.start(msg.data);
      hud.actionStarted(msg.data);
      if (msg.data.actionId === 'big_fish_event') {
        bigFish.active = true;
        updateShadow();
      }
      break;
    case 'action.ended':
      director.end(msg.data.runId);
      if (msg.data.actionId === 'big_fish_event') bigFish.active = false;
      break;
    case 'king':
      director.setMood(msg.data.mood);
      break;
    case 'feed':
      hud.feed(msg.data);
      break;
    case 'leaderboard':
      hud.leaderboard(msg.data.entries, msg.data.participants, msg.data.kgBoard ?? []);
      break;
    case 'roster':
      scene.anglers.sync(msg.data);
      break;
    case 'catches':
      scene.anglers.catches(msg.data);
      break;
    case 'bigfish.next':
      bigFish.at = msg.data.at;
      bigFish.shadowMs = msg.data.shadowMs ?? 0;
      hud.bigFishNext(msg.data.at);
      updateShadow();
      break;
    case 'work':
      scene.anglers.emote(msg.data);
      break;
    case 'collective':
      hud.collective(msg.data);
      break;
    case 'connectors':
      hud.connectors(msg.data);
      break;
    case 'game':
      hud.running(msg.data.running);
      break;
  }
}

/** Kết nối WebSocket chỉ-đọc, tự kết nối lại với backoff. */
function connect(key: string, attempt = 0): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/overlay?key=${encodeURIComponent(key)}`);
  let opened = false;
  ws.onopen = () => {
    opened = true;
    hud.connection(true);
  };
  ws.onmessage = (ev) => {
    try {
      handle(JSON.parse(ev.data as string) as ServerMessage);
    } catch (err) {
      console.warn('Tin nhắn lỗi', err);
    }
  };
  ws.onclose = () => {
    hud.connection(false);
    const next = opened ? 0 : attempt + 1;
    setTimeout(() => connect(key, next), Math.min(15_000, 1000 * 2 ** next));
  };
}

/**
 * Chế độ xem trước hoạt ảnh không cần server (chỉ để dựng/kiểm tra giao diện):
 *   /overlay/?preview=all              chạy lần lượt mọi hoạt ảnh kéo cá
 *   /overlay/?preview=pull_legend      một hoạt ảnh
 *   &people=50                         số cần thủ giả để thử bố cục (mặc định 20)
 */
/** Tên + cá + khoảng cân của từng hành động (khớp defaults.ts của server) — chỉ dùng cho xem trước. */
const PREVIEW_INFO: Record<string, { name: string; emoji: string; fish: string; min: number; max: number }> = {
  pull_carp: { name: 'Kéo cá chép to', emoji: '🐟', fish: 'Cá chép to', min: 3, max: 6 },
  pull_grass_carp: { name: 'Kéo cá trắm cỏ', emoji: '🐠', fish: 'Cá trắm cỏ', min: 6, max: 12 },
  pull_catfish: { name: 'Kéo cá trê khổng lồ', emoji: '🐡', fish: 'Cá trê khổng lồ', min: 10, max: 20 },
  pull_snakehead: { name: 'Kéo cá lóc bông', emoji: '🐟', fish: 'Cá lóc bông', min: 15, max: 25 },
  pull_giant_catfish: { name: 'Kéo cá lăng khủng', emoji: '🦈', fish: 'Cá lăng khủng', min: 25, max: 50 },
  pull_arowana: { name: 'Kéo cá rồng vàng', emoji: '🐉', fish: 'Cá rồng vàng', min: 40, max: 70 },
  pull_stingray: { name: 'Kéo cá đuối nước ngọt', emoji: '🦈', fish: 'Cá đuối khổng lồ', min: 60, max: 120 },
  pull_legend: { name: 'Kéo Cá Thần huyền thoại', emoji: '👑', fish: 'Cá Thần huyền thoại', min: 150, max: 300 },
  pull_koi: { name: 'Kéo cá Koi', emoji: '🎏', fish: 'Cá Koi đỏ trắng', min: 2, max: 5 },
  big_fish_event: { name: 'Cá to xuất hiện!', emoji: '🐋', fish: 'Cá to bí ẩn', min: 8, max: 30 },
  grand_haul: { name: 'Cả hồ kéo Cá Thần', emoji: '👑', fish: 'Cá Thần', min: 200, max: 400 }
};

/** Cá thường (khớp fishing.loot mặc định): emoji, tên, trọng số, kg. */
const PREVIEW_LOOT: [string, string, number, number, number][] = [
  ['🐟', 'Cá rô', 30, 0.1, 0.5],
  ['🐠', 'Cá chép', 22, 0.5, 3],
  ['🐡', 'Cá trắm', 12, 2, 8],
  ['🦐', 'Tôm càng', 12, 0.05, 0.2],
  ['🐢', 'Rùa', 4, 1, 5],
  ['🥾', 'Chiếc ủng rách', 10, 0, 0],
  ['🧦', 'Chiếc tất thối', 6, 0, 0],
  ['🦈', 'Cá lăng khủng', 3, 10, 30],
  ['👑', 'Cá Koi vàng', 1, 3, 6]
];
const kgIn = (a: number, b: number) => Math.round((a + Math.random() * (b - a)) * 10) / 10;

function preview(which: string): void {
  hud.connection(true);
  hud.running(true);
  const people = Math.max(0, Math.min(50, Number(params.get('people') ?? 20) || 0));
  const roster: RosterMember[] = Array.from({ length: people }, (_, i) => ({
    platformId: `preview:${i}`,
    displayName: `Cần thủ ${i + 1}`,
    follower: i % 3 !== 0,
    points: 0,
    seat: i < 5 ? 'front' : i % 2 ? 'left' : 'right',
    kg: 0,
    fishingMs: 0,
    diamonds: 0
  }));
  scene.anglers.sync(roster);

  const ids = which === 'all' ? Object.keys(ANIMATIONS) : [which];
  let i = 0;
  const pushBoards = () => {
    const entry = (m: RosterMember, k: number): LeaderboardEntry => ({
      rank: k + 1,
      platformId: m.platformId,
      displayName: m.displayName,
      participations: 1,
      points: m.points,
      diamonds: m.diamonds,
      kg: m.kg,
      title: ''
    });
    const gifts = [...roster].filter((m) => m.diamonds > 0).sort((a, b) => b.diamonds - a.diamonds).map(entry);
    const kg = [...roster].filter((m) => m.kg > 0).sort((a, b) => b.kg - a.kg).map(entry);
    hud.leaderboard(gifts, roster.length, kg);
  };
  pushBoards();

  const loop = () => {
    const actionId = ids[i % ids.length]!;
    const actorM = roster.length ? roster[(i * 7) % roster.length]! : undefined;
    const info = PREVIEW_INFO[actionId];
    const kg = info ? kgIn(info.min, info.max) : 5;
    const run: RunningAction = {
      runId: `preview-${i}`,
      actionId,
      actionName: info?.name ?? actionId,
      lanes: [],
      actor: actionId === 'grand_haul' ? null : { displayName: actorM?.displayName ?? 'Xem trước' },
      source: actionId === 'grand_haul' ? 'collective' : 'demo',
      startedAt: Date.now(),
      durationMs: PREVIEW_DURATIONS[actionId] ?? 6000,
      fish: { emoji: info?.emoji ?? '🐟', name: info?.fish ?? 'Cá to', kg }
    };
    director.syncClock(Date.now());
    handle({ type: 'action.started', data: run });
    setTimeout(() => handle({ type: 'action.ended', data: { runId: run.runId, actionId } }), run.durationMs);
    if (actorM && actionId !== 'grand_haul') {
      actorM.kg = Math.round((actorM.kg + kg) * 10) / 10;
      actorM.diamonds += [1, 5, 10, 30, 99, 199, 299, 499][i % 8]!;
    }
    pushBoards();
    i += 1;
    setTimeout(loop, run.durationMs + 1500);
  };
  loop();

  // Câu tự động: mỗi 5 giây một người (theo thứ tự vào hồ) lên một con cá.
  const totalW = PREVIEW_LOOT.reduce((a, l) => a + l[2], 0);
  let turn = 0;
  if (roster.length)
    setInterval(() => {
      const m = roster[turn++ % roster.length]!;
      let r = Math.random() * totalW;
      const loot = PREVIEW_LOOT.find((l) => (r -= l[2]) < 0) ?? PREVIEW_LOOT[0]!;
      const ev: CatchEvent = { platformId: m.platformId, displayName: m.displayName, emoji: loot[0], name: loot[1], kg: kgIn(loot[3], loot[4]), at: Date.now() };
      m.kg = Math.round((m.kg + ev.kg) * 10) / 10;
      handle({ type: 'catches', data: [ev] });
      pushBoards();
    }, 5000);

  // Thỉnh thoảng có người bình luận "việc" vui tại chỗ.
  const works = [
    ['🪱', 'Mồi giun xịn đây!'],
    ['🍵', 'Làm cốc trà đá đã...'],
    ['📸', 'Cá to chưa anh em!'],
    ['🎵', 'Ơi à ơi... cá ơi lên đi!'],
    ['😴', 'Zzz... cá cắn câu thì gọi nhé']
  ] as const;
  if (roster.length)
    setInterval(() => {
      const m = roster[Math.floor(Math.random() * roster.length)]!;
      const [emoji, text] = works[Math.floor(Math.random() * works.length)]!;
      const ev: WorkEvent = { platformId: m.platformId, displayName: m.displayName, taskId: 'preview', emoji, text, at: Date.now(), points: 1 };
      handle({ type: 'work', data: ev });
    }, 7000);

  // Cá to định kỳ: 30 giây một lần, bóng cá lượn 15 giây trước đó.
  const scheduleBigFish = () => handle({ type: 'bigfish.next', data: { at: Date.now() + 30_000, shadowMs: 15_000 } });
  scheduleBigFish();
  setInterval(scheduleBigFish, 30_000);
}

const previewId = params.get('preview');
const key = params.get('key');
if (previewId) preview(previewId);
else if (key) connect(key);
else hud.connection(false, 'Thiếu ?key=OVERLAY_KEY trong URL overlay');
