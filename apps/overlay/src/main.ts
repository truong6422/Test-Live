import { Application, Assets, Rectangle, Texture } from 'pixi.js';
import type { BossState, RosterMember, RunningAction, ServerMessage } from '@sep/shared';
import { Hud } from './hud';
import { ANIMATIONS, PREVIEW_DURATIONS } from './scene/animations';
import { BOSS_CLIPS, BOSS_POSES, setBossClips, setBossSprites, type BossClip, type BossPose } from './scene/boss';
import { Director } from './scene/director';
import { buildOffice } from './scene/office';
import { setStaffSprites, STAFF_POSES, type StaffCharacter, type StaffPoseMap } from './scene/people';
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

/** Tải ảnh Sếp. Lỗi/thiếu ảnh nào thì bỏ qua — Sếp vẽ pixel sẵn làm dự phòng. */
async function loadBossSprites(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}sprites/boss/`;
  const loaded: Partial<Record<BossPose, Texture>> = {};
  await Promise.all(
    BOSS_POSES.map(async (p) => {
      try {
        const tex = await Assets.load<Texture>(`${base}${p}.png`);
        tex.source.scaleMode = 'nearest'; // pixel art: giữ nét, không nhoè
        loaded[p] = tex;
      } catch {
        /* dùng hình dự phòng */
      }
    })
  );
  if (loaded.cold) setBossSprites(loaded);
}


/** Tải hoạt ảnh từng khung của Sếp: mỗi hoạt ảnh là 1 dải PNG, cắt thành các khung (không tốn thêm bộ nhớ). */
async function loadBossClips(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}sprites/boss-anim/`;
  try {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) return;
    const manifest = (await res.json()) as Record<string, { frameW: number; frameH: number; frames: number }>;
    const loaded: Partial<Record<BossClip, Texture[]>> = {};
    await Promise.all(
      BOSS_CLIPS.map(async (name) => {
        const m = manifest[name];
        if (!m) return;
        try {
          const strip = await Assets.load<Texture>(`${base}${name}.png`);
          strip.source.scaleMode = 'nearest';
          loaded[name] = Array.from(
            { length: m.frames },
            (_, i) => new Texture({ source: strip.source, frame: new Rectangle(i * m.frameW, 0, m.frameW, m.frameH) })
          );
        } catch {
          /* thiếu hoạt ảnh này → dùng ảnh tư thế */
        }
      })
    );
    setBossClips(loaded);
  } catch {
    /* không có hoạt ảnh → dùng ảnh tư thế / hình vẽ */
  }
}

/**
 * Tải sprite nhân viên (bun run sprites:staff): mỗi nhân vật 1 dải PNG, cắt thành khung dùng chung source.
 * Thiếu manifest/ảnh → giữ người vẽ pixel.
 */
async function loadStaffSprites(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}sprites/staff/`;
  try {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) return;
    const manifest = (await res.json()) as {
      characters: { id: string; frameW: number; frameH: number; frames: number; boxes?: number[][] }[];
      poses: Partial<StaffPoseMap>;
    };
    if (!STAFF_POSES.every((p) => manifest.poses[p] !== undefined)) return;
    const chars = await Promise.all(
      manifest.characters.map(async (m): Promise<StaffCharacter | null> => {
        try {
          const strip = await Assets.load<Texture>(`${base}${m.id}.png`);
          strip.source.scaleMode = 'nearest';
          const frames = Array.from(
            { length: m.frames },
            (_, i) => new Texture({ source: strip.source, frame: new Rectangle(i * m.frameW, 0, m.frameW, m.frameH) })
          );
          const boxes = m.boxes ?? frames.map(() => [0, 0, m.frameW, m.frameH]);
          return { frames, boxes, frameW: m.frameW, frameH: m.frameH };
        } catch {
          return null;
        }
      })
    );
    setStaffSprites(
      chars.filter((c): c is StaffCharacter => c !== null),
      manifest.poses as StaffPoseMap
    );
  } catch {
    /* không có sprite → người vẽ pixel */
  }
}

// Nhẹ máy: không khử răng cưa (pixel art không cần), độ phân giải 1, giới hạn 30 khung hình/giây.
const app = new Application();
await app.init({ width: 1080, height: 1920, antialias: false, background: 0x2b2f3a, resolution: 1, roundPixels: true });
app.ticker.maxFPS = Number(params.get('fps')) || 30;
document.getElementById('scene')!.appendChild(app.canvas);

await Promise.all([loadBossSprites(), loadBossClips(), loadStaffSprites()]);
const scene = buildOffice();
app.stage.addChild(scene.root);
const director = new Director(scene);
const hud = new Hud();
app.ticker.add((t) => director.tick(t.deltaMS));

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case 'snapshot': {
      const s = msg.data;
      director.syncClock(s.serverTime);
      scene.classroom.sync(s.roster ?? []);
      director.reset(s.runningActions);
      director.setMood(s.boss.mood);
      hud.boss(s.boss);
      hud.feed(s.feed);
      hud.leaderboard(s.leaderboard, s.participants);
      hud.collective(s.collective);
      hud.connectors(s.connectors);
      hud.running(s.running);
      break;
    }
    case 'action.started':
      director.start(msg.data);
      hud.actionStarted(msg.data);
      break;
    case 'action.ended':
      director.end(msg.data.runId);
      break;
    case 'boss':
      director.setMood(msg.data.mood);
      hud.boss(msg.data);
      break;
    case 'feed':
      hud.feed(msg.data);
      break;
    case 'leaderboard':
      hud.leaderboard(msg.data.entries, msg.data.participants);
      break;
    case 'roster':
      scene.classroom.sync(msg.data);
      break;
    case 'work':
      scene.classroom.emote(msg.data);
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
 *   /overlay/?preview=all            chạy lần lượt mọi hoạt ảnh
 *   /overlay/?preview=flat_tire      một hoạt ảnh
 *   &people=100                      số nhân viên giả để thử bố cục (mặc định 24)
 */
/** Tên + tác động lên Sếp của từng hành động (khớp defaults.ts của server) — chỉ dùng cho xem trước. */
const PREVIEW_INFO: Record<string, { name: string; calm: number; stamina: number }> = {
  throw_paper: { name: 'Ném giấy vào Sếp', calm: -4, stamina: -2 },
  pluck_tree: { name: 'Vặt lá cây phát tài', calm: -7, stamina: -3 },
  doodle_kpi: { name: 'Vẽ bậy lên bảng KPI', calm: -8, stamina: -3 },
  flat_tire: { name: 'Xịt lốp xe Sếp', calm: -10, stamina: -5 },
  lock_toilet: { name: 'Khóa nhà vệ sinh', calm: -12, stamina: -8 },
  crash_pc: { name: 'Làm treo máy tính Sếp', calm: -8, stamina: -4 },
  complaint_call: { name: 'Khách gọi phàn nàn', calm: -9, stamina: -3 },
  praise_boss: { name: 'Nịnh Sếp', calm: 6, stamina: 2 },
  blackout: { name: 'Ngắt cầu dao', calm: -10, stamina: -6 },
  strike: { name: 'Đình công toàn công ty', calm: -40, stamina: -30 }
};

function preview(which: string): void {
  hud.connection(true);
  hud.running(true);
  const people = Math.max(0, Math.min(100, Number(params.get('people') ?? 24) || 0));
  const roster: RosterMember[] = Array.from({ length: people }, (_, i) => ({
    platformId: `preview:${i}`,
    displayName: `Nhân viên ${i + 1}`,
    follower: i % 3 !== 0,
    points: 0
  }));
  scene.classroom.sync(roster);
  const ids = which === 'all' ? Object.keys(ANIMATIONS) : [which];
  let i = 0;
  // Mô phỏng thanh Sếp giống server (defaults.ts): trừ khi bị trêu, hồi dần theo thời gian.
  const boss: BossState = { calm: 100, stamina: 100, mood: 'normal', exhaustedUntil: 0, lastActionId: null, lastActorName: null };
  const moodOf = (): BossState['mood'] =>
    boss.exhaustedUntil > Date.now() ? 'helpless' : boss.calm >= 80 ? 'normal' : boss.calm >= 60 ? 'annoyed' : boss.calm >= 35 ? 'angry' : boss.calm >= 15 ? 'panic' : 'helpless';
  const pushBoss = () => {
    boss.mood = moodOf();
    hud.boss(boss);
    director.setMood(boss.mood);
  };
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    if (boss.exhaustedUntil <= now) {
      boss.calm = Math.min(100, boss.calm + 0.15 * dt);
      boss.stamina = Math.min(100, boss.stamina + 0.1 * dt);
    }
    pushBoss();
  }, 500);
  const gifted = new Map<string, number>();
  hud.leaderboard([], 0);
  const loop = () => {
    const actionId = ids[i % ids.length]!;
    const actor = roster.length ? roster[(i * 7) % roster.length]!.displayName : 'Xem trước';
    const info = PREVIEW_INFO[actionId];
    if (info) {
      boss.calm = Math.max(0, Math.min(100, boss.calm + info.calm));
      const before = boss.stamina;
      boss.stamina = Math.max(0, Math.min(100, boss.stamina + info.stamina));
      if (boss.stamina <= 0 && before > 0) boss.exhaustedUntil = Date.now() + 12_000;
      pushBoss();
    }
    const run: RunningAction = {
      runId: `preview-${i}`,
      actionId,
      actionName: info?.name ?? actionId,
      lanes: [],
      actor: { displayName: actor },
      source: 'demo',
      startedAt: Date.now(),
      durationMs: PREVIEW_DURATIONS[actionId] ?? 4000
    };
    director.syncClock(Date.now());
    handle({ type: 'action.started', data: run });
    // bảng TOP PHÁ SẾP giả lập: mỗi lượt trêu = một món quà
    gifted.set(actor, (gifted.get(actor) ?? 0) + [1, 5, 10, 30, 99, 199, 299, 499][i % 8]!);
    hud.leaderboard(
      [...gifted.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, diamonds], k) => ({ rank: k + 1, platformId: name, displayName: name, participations: 1, points: 0, title: '', diamonds })),
      gifted.size
    );
    i += 1;
    setTimeout(loop, run.durationMs + 600);
  };
  loop();
  // Thỉnh thoảng có người "làm việc" tại chỗ.
  const works = [
    ['⌨️', 'Đang chạy deadline...'],
    ['📄', 'Báo cáo đây Sếp!'],
    ['☕', 'Nạp cà phê đã...'],
    ['🙏', 'Sếp ơi em xin nghỉ!']
  ] as const;
  if (roster.length)
    setInterval(() => {
      const m = roster[Math.floor(Math.random() * roster.length)]!;
      const [emoji, text] = works[Math.floor(Math.random() * works.length)]!;
      scene.classroom.emote({ platformId: m.platformId, displayName: m.displayName, taskId: 'preview', emoji, text, at: Date.now() });
    }, 1500);
}

const previewId = params.get('preview');
const key = params.get('key');
if (previewId) preview(previewId);
else if (key) connect(key);
else hud.connection(false, 'Thiếu ?key=OVERLAY_KEY trong URL overlay');
