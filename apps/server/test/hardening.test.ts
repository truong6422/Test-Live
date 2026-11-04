import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { NormalizedEvent, ServerMessage } from '@cau/shared';
import { defaultGameConfig } from '../src/config/defaults';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import { TikTokConnector, type LiveConnectionLike } from '../src/connectors/tiktok/tiktok-connector';
import type { ConnectorState, ConnectorStateListener } from '../src/connectors/types';
import { ManualClock } from '../src/engine/clock';
import { GameEngine } from '../src/engine/engine';
import { createApp } from '../src/http/app';
import { silentLogger } from '../src/logger';
import { TikTokNormalizer, type TtGift } from '../src/normalizer/tiktok-normalizer';
import { computeTitle, PlayerRegistry, TITLES, topK } from '../src/players/players';
import { GameService, type TikTokControl } from '../src/service';
import { MemoryStore } from '../src/store/memory-store';
import { ev, giftEv, makeEngine } from './helpers';

// ---------------------------------------------------------------------------
// Engine: quà luôn được ghi nhận
// ---------------------------------------------------------------------------
describe('Quà không bao giờ bị mất', () => {
  test('quà không bị giới hạn tần suất (thả tim dồn dập không ăn mất quà)', () => {
    const { engine } = makeEngine((c) => {
      c.limits.userBucketCapacity = 2;
      c.limits.userBucketRefillPerSec = 0.01;
    });
    expect(engine.ingest(ev({ kind: 'like', likeCount: 1 }, 'a'))).toBe('participated');
    expect(engine.ingest(ev({ kind: 'like', likeCount: 1 }, 'a'))).toBe('participated');
    expect(engine.ingest(ev({ kind: 'like', likeCount: 1 }, 'a'))).toBe('rate_limited');
    for (let i = 0; i < 5; i++) expect(engine.ingest(giftEv('a', 10))).toBe('accepted');
    expect(engine.players.get('a')?.totalDiamonds).toBe(50);
  });

  test('hàng đợi đầy: quà vẫn được cộng cá + điểm, báo lên feed thay hoạt ảnh', () => {
    const { engine, of } = makeEngine((c) => {
      c.limits.maxQueue = 1;
    });
    engine.ingest(giftEv('a', 500)); // chạy ngay
    engine.ingest(giftEv('b', 500)); // chờ (hàng đợi 1/1)
    const out = engine.ingest(giftEv('c', 500)); // cùng ưu tiên → không chen được
    expect(out).toBe('dropped');
    expect(engine.players.get('c')?.totalDiamonds).toBe(500);
    expect(engine.players.get('c')?.totalGrams).toBeGreaterThan(0);
    expect(engine.snapshot().feed.some((f) => f.actorName === 'User c')).toBe(true);
    expect(of('history').find((h) => h.playerId === 'c' && h.kind === 'gift')?.outcome).toBe('dropped');
  });

  test('quà không góp vào sự kiện tập thể (phần thưởng Cá Thần có cân ngẫu nhiên)', () => {
    const { engine } = makeEngine((c) => {
      c.collective.goal = 2;
    });
    engine.ingest(giftEv('a', 1));
    engine.ingest(giftEv('b', 1));
    expect(engine.snapshot().collective?.progress).toBe(0);
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'a'));
    expect(engine.snapshot().collective?.progress).toBe(1);
  });

  test('cá từ quà không mở khoá danh hiệu; "Kẻ phá hồ" chỉ tính việc vui miễn phí', () => {
    const base = { grantedTitles: [] as string[] };
    expect(computeTitle({ ...base, actionCounts: { pull_carp: 50 } })).toBe(TITLES.rookie);
    expect(computeTitle({ ...base, actionCounts: { 'work:hat_ho': 29 } })).toBe(TITLES.rookie);
    expect(computeTitle({ ...base, actionCounts: { 'work:hat_ho': 30 } })).toBe(TITLES.troll);
  });
});

// ---------------------------------------------------------------------------
// Engine: phát tin gom (LIVE đông)
// ---------------------------------------------------------------------------
describe('Gom tin phát ra overlay', () => {
  test('tiến trình tập thể gom theo broadcastInterval; hoàn thành thì phát ngay', () => {
    const clock = new ManualClock();
    const cfg = defaultGameConfig();
    cfg.limits.userBucketCapacity = 1000;
    cfg.limits.globalBucketCapacity = 10_000;
    cfg.collective.goal = 50;
    cfg.fishing.bigFishEveryMs = 0;
    const engine = new GameEngine({ clock, config: cfg, broadcastIntervalMs: 250 });
    const msgs: ServerMessage[] = [];
    engine.subscribe((m) => msgs.push(m));
    engine.start('s');
    msgs.length = 0;
    for (let i = 0; i < 20; i++) engine.ingest(ev({ kind: 'comment', text: 'hi' }, `u${i}`));
    const before = msgs.filter((m) => m.type === 'collective').length;
    expect(before).toBeLessThanOrEqual(1);
    clock.advance(300);
    engine.tick();
    const last = msgs.filter((m) => m.type === 'collective').at(-1);
    expect(last && last.type === 'collective' && last.data?.progress).toBe(20);
  });

  test('quà chỉ phát roster ngay khi Bến Vàng đổi', () => {
    const { engine, of } = makeEngine((c) => {
      c.fishing.frontSeats = 1;
      c.gifts = []; // không kéo cá (không feed → không flush), chỉ xét roster của chính quà
    });
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'a'));
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'b'));
    const n0 = of('roster').length;
    engine.ingest(giftEv('b', 10)); // b lên Bến Vàng
    expect(of('roster').length).toBe(n0 + 1);
    expect(of('roster').at(-1)?.[0]).toMatchObject({ platformId: 'b', seat: 'front' });
    engine.ingest(giftEv('b', 10)); // vẫn b → không phát lại
    expect(of('roster').length).toBe(n0 + 1);
  });

  test('topK cho kết quả giống sort đầy đủ (kể cả hoà)', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ i, v: (i * 7919) % 37 }));
    const cmp = (a: { v: number }, b: { v: number }) => b.v - a.v;
    expect(topK(rows, cmp, 10)).toEqual([...rows].sort(cmp).slice(0, 10));
    expect(topK(rows.slice(0, 5), cmp, 10)).toEqual([...rows.slice(0, 5)].sort(cmp));
  });

  test('game dừng lâu rồi chạy lại: cá to định kỳ hẹn lại một chu kỳ đủ, không bật ngay', () => {
    const { engine, clock, of } = makeEngine((c) => {
      c.fishing.bigFishEveryMs = 60_000;
    });
    engine.stop();
    clock.advance(10 * 60_000);
    engine.start('s1');
    expect(engine.snapshot().nextBigFishAt).toBe(clock.now() + 60_000);
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'a'));
    clock.advance(200);
    engine.tick();
    clock.advance(200);
    engine.tick();
    expect(of('action.started').some((r) => r.actionId === 'big_fish_event')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Demo không bao giờ trộn với LIVE thật
// ---------------------------------------------------------------------------
class FakeTikTok implements TikTokControl {
  readonly name = 'tiktok';
  st: ConnectorState = { status: 'disconnected', username: null, roomId: null, viewerCount: 0, lastError: null, reconnectAttempt: 0 };
  private stateFns: ConnectorStateListener[] = [];
  onEvent() {}
  onState(fn: ConnectorStateListener) {
    this.stateFns.push(fn);
  }
  state() {
    return this.st;
  }
  set(patch: Partial<ConnectorState>) {
    this.st = { ...this.st, ...patch };
    for (const fn of this.stateFns) fn(this.st);
  }
  async connect(u: string) {
    this.set({ status: 'connected', username: u });
  }
  async disconnect() {
    this.set({ status: 'disconnected' });
  }
}

const makeService = async () => {
  const tiktok = new FakeTikTok();
  const demo = new DemoConnector(1000, () => 0.3);
  const store = new MemoryStore();
  const clock = new ManualClock();
  const service = await GameService.create({
    store,
    clock,
    logger: silentLogger,
    defaults: defaultGameConfig(),
    tiktok,
    demo,
    historyRetentionDays: 30
  });
  return { service, tiktok, demo, store, clock };
};

const demoComment = (i: number): NormalizedEvent => ({
  id: `demo:x:${i}`,
  source: 'demo',
  kind: 'comment',
  receivedAt: 0,
  text: 'hello',
  user: { platformId: `demo:${i}`, username: `demo_${i}`, displayName: `Demo ${i}` }
});

describe('Demo ↔ TikTok LIVE thật', () => {
  test('kết nối TikTok thì người chơi demo bị gỡ khỏi hồ và bảng phiên', async () => {
    const { service } = await makeService();
    await service.startGame();
    for (let i = 0; i < 5; i++) service.engine.ingest(demoComment(i));
    service.engine.ingest({ ...demoComment(99), id: 'tt:1', source: 'tiktok', user: { platformId: '42', username: 'real', displayName: 'Real' } });
    expect(service.engine.lakeState().roster).toHaveLength(6);
    await service.connectTikTok('@kenh.that');
    const snap = service.engine.snapshot();
    expect(snap.roster.map((m) => m.platformId)).toEqual(['42']);
    expect(snap.leaderboard.every((e) => !e.platformId.startsWith('demo:'))).toBe(true);
    expect(snap.collective?.progress).toBe(0); // vòng tập thể có lượt demo → mở lại
  });

  test('TikTok tự kết nối lại (kênh lên LIVE) trong lúc demo chạy → demo tắt + dọn', async () => {
    const { service, tiktok, demo } = await makeService();
    await service.startGame();
    service.setDemo(true);
    service.engine.ingest(demoComment(1));
    // Không thể bật demo khi connector đang chờ kênh lên LIVE (offline / error vẫn tự thử lại).
    tiktok.st = { ...tiktok.st, status: 'offline', username: 'kenh' };
    expect(() => service.setDemo(true)).toThrow();
    tiktok.set({ status: 'connected' });
    expect(demo.running).toBe(false);
    expect(service.engine.lakeState().roster).toHaveLength(0);
  });

  test('sự kiện demo tới khi TikTok không ở trạng thái disconnected bị bỏ', async () => {
    const { service, tiktok, demo } = await makeService();
    await service.startGame();
    const listeners = (demo as unknown as { listeners: ((e: NormalizedEvent) => void)[] }).listeners;
    tiktok.st = { ...tiktok.st, status: 'reconnecting' };
    for (const fn of listeners) fn(demoComment(7));
    expect(service.engine.lakeState().roster).toHaveLength(0);
  });

  test('flush gọi chồng nhau vẫn ghi hết (resetSession không bỏ sót)', async () => {
    const { service, store } = await makeService();
    await service.startGame();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = store.savePlayers.bind(store);
    let calls = 0;
    store.savePlayers = async (sid, batch) => {
      if (calls++ === 0) await gate;
      return orig(sid, batch);
    };
    service.engine.ingest({ ...demoComment(0), id: 't1', source: 'tiktok', user: { platformId: 'p1', username: 'p1', displayName: 'P1' } });
    const first = service.flush();
    service.engine.ingest({ ...demoComment(0), id: 't2', source: 'tiktok', user: { platformId: 'p2', username: 'p2', displayName: 'P2' } });
    const second = service.flush();
    release();
    await Promise.all([first, second]);
    expect([...store.players.keys()].sort()).toEqual(['p1', 'p2']);
  });
});

// ---------------------------------------------------------------------------
// Demo profile 'live'
// ---------------------------------------------------------------------------
describe("DemoConnector — profile 'live'", () => {
  const seeded = (seed = 7) => {
    let x = seed;
    return () => (x = (x * 9301 + 49297) % 233280) / 233280;
  };

  test('nhóm người xem lớn dần theo thời gian, chủ yếu bình luận, quà ít và đều là 1 món', () => {
    const d = new DemoConnector(1000, seeded());
    d.setProfile('live', 0);
    const early = new Set<string>();
    for (let i = 0; i < 200; i++) early.add(d.next(1000).user.platformId);
    expect(early.size).toBeLessThanOrEqual(3);
    const kinds: Record<string, number> = {};
    const late = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const e = d.next(60 * 60_000);
      late.add(e.user.platformId);
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      expect(e.source).toBe('demo');
      expect(e.user.platformId.startsWith('demo:')).toBe(true);
      if (e.kind === 'gift') expect(e.gift?.count).toBe(1);
      if (e.kind === 'follow') expect(e.user.follower).toBe(true);
    }
    expect(late.size).toBeGreaterThan(20);
    expect(kinds.comment! / 2000).toBeGreaterThan(0.6);
    expect((kinds.gift ?? 0) / 2000).toBeLessThan(0.08);
  });

  test('bình luận demo trung tính: không giả người xem thật, không gợi ý quà', () => {
    const d = new DemoConnector(1000, seeded(3));
    const texts = new Set<string>();
    for (const profile of ['busy', 'live'] as const) {
      d.setProfile(profile, 0);
      for (let i = 0; i < 3000; i++) {
        const e = d.next(60 * 60_000);
        if (e.kind === 'comment' && e.text) texts.add(e.text);
      }
    }
    const banned = ['ngồi Bến Vàng kiểu gì vậy', 'lần đầu xem', 'Hà Nội điểm danh', 'mình ở Cần Thơ nè', 'kéo cá to đi'];
    for (const b of banned) expect(texts.has(b)).toBe(false);
    for (const t of texts) expect(t).not.toMatch(/quà|tặng|donate/i);
  });

  test('start/stop: listener lỗi không làm chết vòng; stop() dừng hẳn, không tự bật lại', async () => {
    const d = new DemoConnector(1000, () => 0.01); // 1,5s + 0,03s giữa các sự kiện
    let n = 0;
    d.onEvent(() => {
      n++;
      throw new Error('listener hỏng');
    });
    d.start('live');
    expect(d.running).toBe(true);
    expect(d.mode).toBe('live');
    await new Promise((r) => setTimeout(r, 900)); // sự kiện đầu sau 800ms
    expect(n).toBe(1);
    expect(d.running).toBe(true); // vòng vẫn được hẹn tiếp
    d.stop();
    expect(d.running).toBe(false);
    d.start('busy');
    expect(d.mode).toBe('busy');
    d.stop();
    expect(d.running).toBe(false);
  });

  test('POST /api/demo/start nhận {profile}; profile lạ → 400; không body → busy', async () => {
    const { service } = await makeService();
    const env = { ADMIN_PASSWORD: 'mat-khau-test', SESSION_SECRET: 'z'.repeat(40), COOKIE_SECURE: false, STATIC_DIR: undefined, OVERLAY_KEY: 'khoa-overlay-123' };
    const app = createApp({ service, env, logger: silentLogger });
    let cookie = '';
    const req = (path: string, body?: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    cookie = (await req('/api/auth/login', { password: env.ADMIN_PASSWORD })).headers.get('set-cookie')!.split(';')[0]!;
    const demo = (service as unknown as { demo: DemoConnector }).demo;
    expect((await req('/api/demo/start', { profile: 'live' })).status).toBe(200);
    expect(demo.mode).toBe('live');
    expect((await req('/api/demo/start', { profile: 'hack' })).status).toBe(400);
    expect((await req('/api/demo/start')).status).toBe(200);
    expect(demo.mode).toBe('busy');
    expect((await req('/api/actions/khong_co/trigger', {})).status).toBe(404);
    expect((await req('/api/live/connect', { username: 'http://evil.local/' })).status).toBe(400);
    await req('/api/demo/stop', {});
    expect(demo.running).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TikTok: streak, timeout kết nối, backoff khi chập chờn
// ---------------------------------------------------------------------------
describe('TikTok — ổn định khi chạy lâu', () => {
  const user = { id: '7001', displayId: 'lan', nickname: 'Lan' };
  const rose = (msgId: string, repeatCount: number, repeatEnd: number): TtGift => ({
    common: { msgId },
    user,
    giftId: '5655',
    repeatCount,
    repeatEnd,
    gift: { name: 'Rose', diamondCount: 1, type: 1 }
  });

  test('streak chốt do timeout không nuốt streak mới cùng quà (không có groupId)', () => {
    const n = new TikTokNormalizer({ streakTimeoutMs: 1000 });
    n.gift(rose('a', 5, 0), 0);
    expect(n.flushStale(1000)[0]?.gift?.count).toBe(5);
    expect(n.gift(rose('late', 6, 0), 1100)).toBeNull(); // message muộn của streak cũ
    // streak mới bắt đầu lại từ 1 → phải được tính
    expect(n.gift(rose('n1', 1, 0), 2000)).toBeNull();
    expect(n.gift(rose('n2', 3, 1), 2100)?.gift?.count).toBe(3);
  });

  class Conn extends EventEmitter implements LiveConnectionLike {
    constructor(private fn: () => Promise<unknown>) {
      super();
    }
    connect() {
      return this.fn();
    }
    async disconnect() {}
  }

  test('connect() treo → hết giờ thì báo lỗi và tự thử lại', async () => {
    let i = 0;
    const c = new TikTokConnector({
      logger: silentLogger,
      factory: () => new Conn(i++ === 0 ? () => new Promise(() => {}) : () => Promise.resolve({ roomId: 'r' })),
      connectTimeoutMs: 20,
      baseDelayMs: 5,
      random: () => 0.5
    });
    await c.connect('kenh.test');
    expect(c.state().status).toBe('error');
    await new Promise((r) => setTimeout(r, 40));
    expect(c.state().status).toBe('connected');
    await c.disconnect();
  });

  test('kết nối được rồi rớt ngay liên tục → backoff vẫn tăng (không dội TikTok mỗi 2s)', async () => {
    const conns: Conn[] = [];
    let t = 0;
    const c = new TikTokConnector({
      logger: silentLogger,
      factory: () => {
        const conn = new Conn(() => Promise.resolve({ roomId: 'r' }));
        conns.push(conn);
        return conn;
      },
      baseDelayMs: 1,
      maxDelayMs: 1000,
      stableMs: 60_000,
      random: () => 0.5,
      now: () => t
    });
    await c.connect('kenh.test');
    const attempts: number[] = [];
    for (let k = 0; k < 3; k++) {
      t += 1000; // chỉ giữ được 1s
      conns.at(-1)!.emit('disconnected');
      attempts.push(c.state().reconnectAttempt);
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(attempts).toEqual([1, 2, 3]);
    // Giữ được lâu hơn stableMs → backoff về 1.
    t += 120_000;
    conns.at(-1)!.emit('disconnected');
    expect(c.state().reconnectAttempt).toBe(1);
    await c.disconnect();
  });
});

describe('PlayerRegistry — dọn dẹp', () => {
  test('purge gỡ khỏi hồ, bảng phiên và bộ nhớ', () => {
    const r = new PlayerRegistry();
    for (const id of ['demo:1', 'demo:2', '9']) {
      r.participate({ platformId: id, username: id, displayName: id }, 1);
      r.join(id, 0);
    }
    expect(r.purge((id) => id.startsWith('demo:'))).toBe(2);
    expect(r.roster().map((m) => m.platformId)).toEqual(['9']);
    expect(r.participants()).toBe(1);
    expect(r.get('demo:1')).toBeUndefined();
  });
});
