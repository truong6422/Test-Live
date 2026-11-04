import { describe, expect, test } from 'bun:test';
import { defaultGameConfig } from '../src/config/defaults';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import type { ConnectorState, ConnectorStateListener } from '../src/connectors/types';
import { ManualClock } from '../src/engine/clock';
import { MAX_CONTRIBUTIONS_PER_USER } from '../src/engine/collective';
import { BIG_FISH_MAX_POSTPONE_MS, catchesThisTick, KICK_REJOIN_BLOCK_MS } from '../src/engine/engine';
import { silentLogger } from '../src/logger';
import { PlayerRegistry } from '../src/players/players';
import { AUTO_RESUME_MAX_IDLE_MS, GameService, type TikTokControl } from '../src/service';
import { MemoryStore } from '../src/store/memory-store';
import { ev, giftEv, makeEngine } from './helpers';

const comment = (user: string, text = 'hi') => ev({ kind: 'comment', text }, user);

// ---------------------------------------------------------------------------
// 1. Game dừng: quà không bao giờ bị bỏ
// ---------------------------------------------------------------------------
describe('Game dừng', () => {
  test('quà vẫn được cộng cá cố định + kim cương + điểm và chạy hoạt ảnh; bình luận vẫn vào hồ', () => {
    const { engine, clock, of } = makeEngine((c) => {
      c.collective.goal = 2;
    });
    engine.stop();
    expect(engine.ingest(comment('a'))).toBe('game_stopped');
    expect(engine.lakeState().roster.map((m) => m.platformId)).toEqual(['a']);
    expect(engine.ingest(giftEv('g', 500))).toBe('accepted');
    expect(engine.players.get('g')?.totalDiamonds).toBe(500);
    expect(engine.players.get('g')?.totalGrams).toBe(225_000); // fixedBigFish: giữa 150–300 kg
    expect(engine.players.get('g')?.totalPoints).toBeGreaterThan(500);
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_legend']);
    expect(engine.snapshot().feed[0]?.actorName).toBe('User g');
    // Câu tự động, cá to và tập thể dừng.
    engine.ingest(comment('b'));
    expect(engine.snapshot().collective?.progress).toBe(0);
    clock.advance(30_000);
    engine.tick();
    expect(of('catches')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Khởi động lại: bộ đếm phiên và tự chạy lại
// ---------------------------------------------------------------------------
class FakeTikTok implements TikTokControl {
  readonly name = 'tiktok';
  st: ConnectorState = { status: 'disconnected', username: null, roomId: null, viewerCount: 0, lastError: null, reconnectAttempt: 0 };
  private fns: ConnectorStateListener[] = [];
  onEvent() {}
  onState(fn: ConnectorStateListener) {
    this.fns.push(fn);
  }
  state() {
    return this.st;
  }
  set(patch: Partial<ConnectorState>) {
    this.st = { ...this.st, ...patch };
    for (const fn of this.fns) fn(this.st);
  }
  async connect(u: string) {
    this.set({ status: 'connected', username: u });
  }
  async disconnect() {
    this.set({ status: 'disconnected' });
  }
}

const boot = (store: MemoryStore, clock: ManualClock, tiktok = new FakeTikTok()) =>
  GameService.create({
    store,
    clock,
    logger: silentLogger,
    defaults: defaultGameConfig(),
    tiktok,
    demo: new DemoConnector(),
    historyRetentionDays: 30
  });

const real = (id: string, i: number) => ({
  id: `tt:${id}:${i}`,
  source: 'tiktok' as const,
  kind: 'comment' as const,
  receivedAt: 0,
  text: 'xin chào',
  user: { platformId: id, username: id, displayName: id.toUpperCase() }
});

describe('Khởi động lại server', () => {
  test('bộ đếm phiên tiếp tục từ giá trị đã lưu (không ghi đè số liệu phiên bằng số nhỏ hơn)', async () => {
    const store = new MemoryStore();
    const clock = new ManualClock();
    const s1 = await boot(store, clock);
    await s1.startGame();
    const sid = s1.engine.currentSessionId!;
    s1.engine.ingest(real('p', 1));
    s1.engine.ingest({ ...real('p', 2), kind: 'gift', gift: { giftId: 1, name: 'Rose', count: 1, diamonds: 1 } } as never);
    await s1.flush();
    const before = store.sessionStats.get(sid)!.get('p')!;
    expect(before.participations).toBe(2);

    // "Khởi động lại": service mới, cùng store.
    clock.advance(60_000);
    const s2 = await boot(store, clock);
    expect(s2.engine.currentSessionId).toBe(sid);
    expect(s2.engine.players.sessionStat('p')).toMatchObject({ participations: 2, diamonds: 1 });
    s2.engine.ingest(real('p', 3));
    await s2.flush();
    expect(store.sessionStats.get(sid)!.get('p')!.participations).toBe(3);
    expect(store.sessionStats.get(sid)!.get('p')!.diamonds).toBe(1);
  });

  test('tự chạy lại nếu trước đó đang chạy và phiên mới hoạt động gần đây; quá lâu / đã dừng thì không', async () => {
    const store = new MemoryStore();
    const clock = new ManualClock();
    const s1 = await boot(store, clock);
    await s1.startGame();
    s1.engine.ingest(real('p', 1));
    await s1.flush();

    clock.advance(10 * 60_000);
    const s2 = await boot(store, clock);
    expect(s2.engine.isRunning).toBe(true);
    expect(s2.engine.currentSessionId).toBe(s1.engine.currentSessionId);

    clock.advance(AUTO_RESUME_MAX_IDLE_MS + 60_000);
    const s3 = await boot(store, clock);
    expect(s3.engine.isRunning).toBe(false);

    // Admin bấm dừng trước khi tắt → khởi động lại vẫn dừng.
    const store2 = new MemoryStore();
    const a = await boot(store2, clock);
    await a.startGame();
    a.stopGame();
    await a.flush();
    expect((await boot(store2, clock)).engine.isRunning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Tốc độ câu tự động theo số người + ưu tiên con đầu tiên
// ---------------------------------------------------------------------------
describe('Tốc độ câu động', () => {
  test('catchesThisTick = clamp(ceil(N·tick/target), catchesPerTick, max), không quá N', () => {
    const f = defaultGameConfig().fishing;
    expect(catchesThisTick(f, 0, 5000)).toBe(0);
    expect(catchesThisTick(f, 1, 5000)).toBe(1);
    expect(catchesThisTick(f, 6, 5000)).toBe(1);
    expect(catchesThisTick(f, 7, 5000)).toBe(2);
    expect(catchesThisTick(f, 30, 5000)).toBe(5);
    expect(catchesThisTick(f, 50, 5000)).toBe(8);
    expect(catchesThisTick({ ...f, catchesPerTick: 3 }, 2, 5000)).toBe(2);
    expect(catchesThisTick({ ...f, targetCatchMs: undefined, maxCatchesPerTick: undefined }, 50, 5000)).toBe(8);
  });

  test('người mới vào chưa có cá được con đầu tiên ở chu kỳ kế (trong ngân sách)', () => {
    const { engine, clock, of } = makeEngine();
    for (const id of ['a', 'b', 'c']) engine.ingest(comment(id));
    for (let i = 0; i < 3; i++) {
      clock.advance(5000);
      engine.tick();
    }
    engine.ingest(comment('new'));
    expect(engine.lakeState().nextTurnId).toBe('new');
    clock.advance(5000);
    engine.tick();
    expect(of('catches').at(-1)!.map((c) => c.platformId)).toEqual(['new']);
    clock.advance(5000);
    engine.tick();
    expect(of('catches').at(-1)!.map((c) => c.platformId)).toEqual(['a']); // xoay vòng tiếp tục
  });
});

// ---------------------------------------------------------------------------
// 5. Hoạt động / mời rời hồ
// ---------------------------------------------------------------------------
describe('Hoạt động trong hồ', () => {
  test('tim / share / follow của người đang ngồi làm mới thời gian rời hồ; không đưa người mới vào', () => {
    const { engine, clock } = makeEngine((c) => {
      c.fishing.idleKickMs = 60_000;
    });
    engine.ingest(comment('a'));
    engine.ingest(comment('b'));
    clock.advance(50_000);
    engine.ingest(ev({ kind: 'like', likeCount: 1 }, 'a'));
    engine.ingest(ev({ kind: 'share' }, 'x'));
    clock.advance(20_000);
    engine.tick();
    expect(engine.lakeState().roster.map((m) => m.platformId)).toEqual(['a']);
  });

  test('hồ đầy: ưu tiên mời người lâu không hoạt động nhất ĐÃ có cá; người mới chưa câu được giữ chỗ', () => {
    const r = new PlayerRegistry();
    r.capacity = 3;
    const u = (id: string) => ({ platformId: id, username: id, displayName: id });
    for (const id of ['new1', 'old', 'mid']) {
      r.participate(u(id), 1);
      r.join(id, 0);
    }
    r.markCaught('old');
    r.markCaught('mid');
    r.participate(u('x'), 1);
    expect(r.join('x', 1)).toBe('old'); // new1 lâu nhất nhưng chưa có cá → giữ chỗ
  });
});

// ---------------------------------------------------------------------------
// 6. Sự kiện tập thể
// ---------------------------------------------------------------------------
describe('Sự kiện tập thể', () => {
  test(`mỗi người góp tối đa ${MAX_CONTRIBUTIONS_PER_USER} lượt mỗi vòng; người bị mời rời hồ không góp`, () => {
    const { engine } = makeEngine((c) => {
      c.collective.goal = 100;
    });
    for (let i = 0; i < 10; i++) engine.ingest(comment('spam'));
    expect(engine.snapshot().collective?.progress).toBe(MAX_CONTRIBUTIONS_PER_USER);
    engine.ingest(comment('k'));
    engine.kick('k');
    engine.ingest(comment('k'));
    expect(engine.snapshot().collective?.progress).toBe(MAX_CONTRIBUTIONS_PER_USER + 1);
  });

  test('người góp sức rồi bị mời rời hồ không nhận phần chia Cá Thần', () => {
    const { engine } = makeEngine((c) => {
      c.collective.goal = 3;
    });
    engine.ingest(comment('a'));
    engine.ingest(comment('k'));
    engine.kick('k');
    engine.ingest(comment('b'));
    expect(engine.snapshot().collective?.status).toBe('completed');
    expect(engine.players.sessionStat('k')?.grams ?? 0).toBe(0);
    expect(engine.players.sessionStat('a')!.grams).toBeGreaterThan(0);
    expect(KICK_REJOIN_BLOCK_MS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Cá to định kỳ không bị quà bỏ đói
// ---------------------------------------------------------------------------
describe('Cá to định kỳ', () => {
  test(`hoãn vì quà tối đa ${BIG_FISH_MAX_POSTPONE_MS / 1000}s, sau đó chạy ngay sau hoạt ảnh đang chạy`, () => {
    const { engine, clock, of } = makeEngine((c) => {
      c.fishing.bigFishEveryMs = 60_000;
      c.fishing.tickMs = 600_000;
      c.limits.queueMaxWaitMs = 600_000;
      c.limits.maxQueue = 100;
    });
    engine.ingest(comment('a'));
    clock.advance(55_000);
    // Quà dồn dập liên tục (mỗi quà 12s hoạt ảnh) — hàng đợi không bao giờ trống.
    let g = 0;
    const startedBig = () => of('action.started').filter((r) => r.actionId === 'big_fish_event');
    for (let t = 0; t < 200 && startedBig().length === 0; t++) {
      if (t % 20 === 0) engine.ingest(giftEv(`g${g++}`, 500));
      clock.advance(500);
      engine.tick();
    }
    expect(startedBig()).toHaveLength(1);
    const startedAt = startedBig()[0]!.startedAt;
    // Đến hạn tại 60s, chạy muộn nhất ≈ 60s hoãn + một hoạt ảnh quà (12s).
    expect(startedAt - (1_000_000 + 60_000)).toBeLessThanOrEqual(BIG_FISH_MAX_POSTPONE_MS + 13_000);
  });

  test('từ 2 người trở lên không trúng cá to hai lần liền', () => {
    const { engine, clock, of } = makeEngine(
      (c) => {
        c.fishing.bigFishEveryMs = 60_000;
        c.fishing.tickMs = 600_000;
      },
      () => 0 // luôn chọn người đầu danh sách
    );
    engine.ingest(comment('a'));
    engine.ingest(comment('b'));
    const winners: string[] = [];
    for (let k = 0; k < 4; k++) {
      clock.advance(Math.max(0, engine.snapshot().nextBigFishAt - clock.now()));
      engine.tick();
      clock.advance(100);
      engine.tick();
      clock.advance(20_000);
      engine.tick();
      winners.push(of('action.started').at(-1)!.actor!.displayName);
    }
    for (let i = 1; i < winners.length; i++) expect(winners[i]).not.toBe(winners[i - 1]);
  });
});

// ---------------------------------------------------------------------------
// 8. LIVE kết thúc → tạm dừng câu tự động / cá to
// ---------------------------------------------------------------------------
describe('LIVE kết thúc', () => {
  test('TikTok offline: dừng câu tự động + đồng hồ cá to; kết nối lại thì chạy tiếp, không mời rời hồ oan', async () => {
    const store = new MemoryStore();
    const clock = new ManualClock();
    const tiktok = new FakeTikTok();
    const svc = await boot(store, clock, tiktok);
    const cfg = svc.getConfig();
    await svc.updateFishing({ ...cfg.fishing, idleKickMs: 60_000 });
    await svc.connectTikTok('@kenh');
    await svc.startGame();
    svc.engine.ingest(real('p', 1));
    const due = svc.engine.snapshot().nextBigFishAt;
    tiktok.set({ status: 'offline' });
    expect(svc.engine.snapshot().streamOffline).toBe(true);
    const msgs: string[] = [];
    svc.subscribe((m) => msgs.push(m.type));
    clock.advance(5 * 60_000);
    svc.engine.tick();
    expect(msgs).not.toContain('catches');
    expect(svc.engine.lakeState().roster).toHaveLength(1); // không bị mời rời hồ khi LIVE tạm dừng
    tiktok.set({ status: 'connected' });
    expect(svc.engine.snapshot().streamOffline).toBe(false);
    expect(svc.engine.snapshot().nextBigFishAt).toBe(due + 5 * 60_000); // đồng hồ cá to đóng băng
    clock.advance(5000);
    svc.engine.tick();
    expect(msgs).toContain('catches');
    expect(svc.engine.lakeState().roster).toHaveLength(1);
  });
});
