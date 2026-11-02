import { describe, expect, test } from 'bun:test';
import { containsKeyword, foldVietnamese } from '@sep/shared';
import { CONFIG_VERSION, DEFAULT_ACTIONS, DEFAULT_BOSS, DEFAULT_GIFTS, defaultGameConfig, reconcileConfig } from '../src/config/defaults';
import { applyEffect, initialBoss, moodFor, recover } from '../src/engine/boss';
import { CollectiveTracker } from '../src/engine/collective';
import { CooldownTracker } from '../src/engine/cooldown';
import { Deduper } from '../src/engine/dedupe';
import { matchAction } from '../src/engine/matcher';
import { ActionQueue } from '../src/engine/queue';
import { RateLimiter } from '../src/engine/rate-limit';
import { AnimationScheduler } from '../src/engine/scheduler';
import { computeTitle, PlayerRegistry } from '../src/players/players';
import { MemoryStore } from '../src/store/memory-store';
import { commentTriggers, ev, LEGACY_COMMENT_KEYWORDS, testConfig } from './helpers';

describe('text', () => {
  test('foldVietnamese bỏ dấu, chữ thường, ký tự lạ', () => {
    expect(foldVietnamese('Đổ CÀ-PHÊ!!')).toBe('do ca phe');
    expect(foldVietnamese('  Khóa   WC 🚽 ')).toBe('khoa wc');
  });
  test('containsKeyword theo ranh giới từ', () => {
    expect(containsKeyword('do ca phe len ban', 'cà phê')).toBe(true);
    expect(containsKeyword('hop dong', 'hop khan')).toBe(false);
    expect(containsKeyword('vlog 12', '1')).toBe(false);
    expect(containsKeyword('1', '1')).toBe(true);
  });
});

describe('Deduper', () => {
  test('trùng ID trong TTL bị chặn, hết TTL thì cho qua', () => {
    const d = new Deduper(100, 1000);
    expect(d.isDuplicate('a', 0)).toBe(false);
    expect(d.isDuplicate('a', 500)).toBe(true);
    expect(d.isDuplicate('a', 1600)).toBe(false);
  });
  test('giới hạn kích thước', () => {
    const d = new Deduper(3, 60_000);
    for (const id of ['a', 'b', 'c', 'd']) d.isDuplicate(id, 0);
    expect(d.size).toBe(3);
    expect(d.isDuplicate('a', 1)).toBe(false); // 'a' đã bị đẩy ra
  });
});

describe('RateLimiter', () => {
  test('giới hạn theo người và hồi lại theo thời gian', () => {
    const rl = new RateLimiter({ userCapacity: 2, userRefillPerSec: 1, globalCapacity: 100, globalRefillPerSec: 100 }, 0);
    expect(rl.allow('u', 0)).toBe(true);
    expect(rl.allow('u', 0)).toBe(true);
    expect(rl.allow('u', 0)).toBe(false);
    expect(rl.allow('other', 0)).toBe(true);
    expect(rl.allow('u', 1000)).toBe(true);
  });
  test('giới hạn toàn cục', () => {
    const rl = new RateLimiter({ userCapacity: 10, userRefillPerSec: 1, globalCapacity: 3, globalRefillPerSec: 0 }, 0);
    expect(['a', 'b', 'c', 'd'].map((u) => rl.allow(u, 0))).toEqual([true, true, true, false]);
  });
});

describe('CooldownTracker', () => {
  test('cooldown toàn cục và theo người', () => {
    const cd = new CooldownTracker();
    cd.mark('x', 'u1', 0);
    expect(cd.check('x', 'u2', 1000, 5000, 500)).toBe(false); // toàn cục
    expect(cd.check('x', 'u2', 1000, 5000, 1500)).toBe(true);
    expect(cd.check('x', 'u1', 1000, 5000, 1500)).toBe(false); // theo người
    expect(cd.check('x', 'u1', 1000, 5000, 5000)).toBe(true);
  });
});

describe('ActionQueue', () => {
  const item = (actionId: string, priority: number, lanes: any[] = ['boss']) => ({ actionId, priority, lanes, enqueuedAt: 0, payload: null });

  test('lấy ưu tiên cao trước, cùng ưu tiên thì FIFO', () => {
    const q = new ActionQueue(10);
    q.push(item('a', 1));
    q.push(item('b', 5));
    q.push(item('c', 5));
    expect(q.popRunnable(new Set())?.actionId).toBe('b');
    expect(q.popRunnable(new Set())?.actionId).toBe('c');
    expect(q.popRunnable(new Set())?.actionId).toBe('a');
  });

  test('bỏ qua mục có lane đang bận', () => {
    const q = new ActionQueue(10);
    q.push(item('boss', 5, ['boss']));
    q.push(item('car', 1, ['car']));
    expect(q.popRunnable(new Set(['boss']))?.actionId).toBe('car');
  });

  test('mục ưu tiên cao bị chặn sẽ giữ chỗ lane, không bị chen', () => {
    const q = new ActionQueue(10);
    q.push(item('strike', 100, ['boss', 'car']));
    q.push(item('car', 1, ['car']));
    q.push(item('desk', 1, ['desk']));
    // boss bận -> strike chưa chạy được, car bị giữ chỗ, desk vẫn chạy được
    expect(q.popRunnable(new Set(['boss']))?.actionId).toBe('desk');
    expect(q.popRunnable(new Set(['boss']))).toBeNull();
  });

  test('đầy: mục ưu tiên cao đẩy mục thấp nhất, mục thấp bị từ chối', () => {
    const q = new ActionQueue(2);
    q.push(item('a', 1));
    q.push(item('b', 2));
    const r1 = q.push(item('c', 0));
    expect(r1.ok).toBe(false);
    const r2 = q.push(item('d', 9));
    expect(r2.ok && r2.dropped?.actionId).toBe('a');
    expect(q.length).toBe(2);
  });

  test('gỡ mục quá hạn', () => {
    const q = new ActionQueue(5);
    q.push({ ...item('old', 1), enqueuedAt: 0 });
    q.push({ ...item('new', 1), enqueuedAt: 900 });
    expect(q.removeExpired(1000, 500).map((i) => i.actionId)).toEqual(['old']);
    expect(q.length).toBe(1);
  });
});

describe('AnimationScheduler', () => {
  const run = (runId: string, lanes: any[], startedAt = 0, durationMs = 1000) => ({
    runId,
    actionId: runId,
    actionName: runId,
    lanes,
    actor: null,
    source: 'demo' as const,
    startedAt,
    durationMs
  });

  test('không cho chạy chung lane, giới hạn song song', () => {
    const s = new AnimationScheduler(2);
    s.start(run('a', ['boss']));
    expect(s.canRun(['boss'])).toBe(false);
    expect(s.canRun(['car'])).toBe(true);
    s.start(run('b', ['car']));
    expect(s.canRun(['desk'])).toBe(false); // vượt giới hạn 2
    expect(() => s.start(run('c', ['desk']))).toThrow();
  });

  test('kết thúc đúng thời lượng', () => {
    const s = new AnimationScheduler(2);
    s.start(run('a', ['boss'], 0, 1000));
    expect(s.finishDue(999)).toHaveLength(0);
    expect(s.finishDue(1000).map((r) => r.runId)).toEqual(['a']);
    expect(s.size).toBe(0);
  });
});

describe('matcher', () => {
  // Cơ chế so khớp bình luận vẫn còn (admin bật lại được) — thử với trigger bình luận kiểu bản 1.
  const { actions, gifts } = testConfig(commentTriggers);

  test('mặc định: bình luận / like / share không kích hoạt trò trêu Sếp', () => {
    const d = defaultGameConfig();
    for (const text of ['1', '4', '9', 'ném giấy', 'vặt lá cây phát tài', 'cúp điện', 'khen sếp']) {
      expect(matchAction(ev({ kind: 'comment', text }), d.actions, d.gifts)).toBeNull();
    }
    expect(matchAction(ev({ kind: 'like', likeCount: 10 }), d.actions, d.gifts)).toBeNull();
    expect(matchAction(ev({ kind: 'share' }), d.actions, d.gifts)).toBeNull();
    expect(matchAction(ev({ kind: 'follow' }), d.actions, d.gifts)).toBeNull();
  });

  test('bình luận theo từ khoá và số', () => {
    expect(matchAction(ev({ kind: 'comment', text: 'Vặt lá cây phát tài của sếp' }), actions, gifts)?.action.id).toBe('pluck_tree');
    expect(matchAction(ev({ kind: 'comment', text: 'vẽ bậy lên bảng KPI' }), actions, gifts)?.action.id).toBe('doodle_kpi');
    expect(matchAction(ev({ kind: 'comment', text: 'cúp điện!!' }), actions, gifts)?.action.id).toBe('blackout');
    expect(matchAction(ev({ kind: 'comment', text: '9' }), actions, gifts)?.action.id).toBe('blackout');
    expect(matchAction(ev({ kind: 'comment', text: 'đổ cà phê' }), actions, gifts)).toBeNull();
    expect(matchAction(ev({ kind: 'comment', text: '4' }), actions, gifts)?.action.id).toBe('flat_tire');
    expect(matchAction(ev({ kind: 'comment', text: 'chào mọi người' }), actions, gifts)).toBeNull();
  });

  test('bình luận khớp nhiều từ khoá thì chọn từ khoá dài nhất', () => {
    expect(matchAction(ev({ kind: 'comment', text: '1 cúp điện' }), actions, gifts)?.action.id).toBe('blackout');
  });

  test('quà theo bậc kim cương mặc định (giá trị = kim cương × số lượng)', () => {
    const gift = (diamonds: number, count = 1, giftId = 9999) => ev({ kind: 'gift', gift: { giftId, name: 'g', count, diamonds } });
    const at = (diamonds: number, count = 1, giftId = 9999) => matchAction(gift(diamonds, count, giftId), actions, gifts)?.action.id;
    expect(at(1)).toBe('throw_paper');
    expect(at(4)).toBe('throw_paper');
    expect(at(5)).toBe('pluck_tree');
    expect(at(1, 5, 5655)).toBe('pluck_tree'); // Rose ×5
    expect(at(1, 10, 5655)).toBe('doodle_kpi'); // Rose ×10
    expect(at(20)).toBe('doodle_kpi'); // Perfume
    expect(at(30)).toBe('complaint_call'); // Doughnut
    expect(at(99)).toBe('crash_pc'); // Hat and Mustache
    expect(at(99, 2)).toBe('crash_pc'); // 198 < 199
    expect(at(99, 3)).toBe('lock_toilet'); // 297
    expect(at(299)).toBe('flat_tire');
    expect(at(498)).toBe('flat_tire');
    expect(at(499)).toBe('blackout');
    expect(at(500)).toBe('blackout'); // Money Gun
    expect(at(34_999)).toBe('blackout'); // quà rất to vẫn là bậc cao nhất
  });

  test('giftId cụ thể thắng trước; không rõ giá trị thì lấy bậc thấp nhất', () => {
    const g = (giftId: number, diamonds: number, count = 1) => ev({ kind: 'gift', gift: { giftId, name: 'g', count, diamonds } });
    expect(matchAction(g(7934, 1), actions, gifts)?.action.id).toBe('praise_boss'); // Heart Me
    expect(matchAction(g(7934, 1, 600), actions, gifts)?.action.id).toBe('praise_boss'); // vẫn là mapping riêng
    expect(matchAction(g(1234, 0), actions, gifts)?.action.id).toBe('throw_paper');
    expect(matchAction(g(1234, 0, 50), actions, gifts)?.action.id).toBe('throw_paper');
  });

  test('bậc tuỳ chỉnh: minCount, bậc bị tắt, giá trị dưới mọi bậc, mapping riêng có minDiamonds', () => {
    const custom = [
      { giftId: 0, giftName: 'a', actionId: 'pluck_tree', minCount: 1, minDiamonds: 10, enabled: true },
      { giftId: 0, giftName: 'b', actionId: 'blackout', minCount: 1, minDiamonds: 100, enabled: false },
      { giftId: 0, giftName: 'c', actionId: 'crash_pc', minCount: 5, minDiamonds: 50, enabled: true },
      { giftId: 0, giftName: 'd', actionId: 'doodle_kpi', minCount: 1, minDiamonds: 50, enabled: true },
      { giftId: 42, giftName: 'riêng', actionId: 'lock_toilet', minCount: 1, minDiamonds: 200, enabled: true }
    ];
    const at = (giftId: number, diamonds: number, count = 1) =>
      matchAction(ev({ kind: 'gift', gift: { giftId, name: 'g', count, diamonds } }), actions, custom)?.action.id ?? null;
    expect(at(1, 9)).toBeNull(); // dưới mọi bậc
    expect(at(1, 10)).toBe('pluck_tree');
    expect(at(1, 500)).toBe('doodle_kpi'); // bậc 100 bị tắt; 50 với minCount 1 (count=1 < 5)
    expect(at(1, 10, 5)).toBe('crash_pc'); // 50 kim cương, count 5: hoà minDiamonds → minCount cao hơn thắng
    expect(at(1, 0)).toBe('pluck_tree'); // không rõ giá trị → bậc thấp nhất
    expect(at(42, 100, 2)).toBe('lock_toilet'); // mapping riêng đủ mốc
    expect(at(42, 100)).toBe('doodle_kpi'); // mapping riêng chưa đủ mốc → rơi về bậc giftId 0
  });

  test('mapping quà bị tắt thì không khớp', () => {
    const off = gifts.map((g) => ({ ...g, enabled: false }));
    expect(matchAction(ev({ kind: 'gift', gift: { giftId: 5655, name: 'Rose', count: 1, diamonds: 1 } }), actions, off)).toBeNull();
  });
});

describe('boss', () => {
  test('ngưỡng cảm xúc', () => {
    expect([100, 80, 79, 60, 59, 35, 34, 15, 14, 0].map((c) => moodFor(c, false))).toEqual([
      'normal', 'normal', 'annoyed', 'annoyed', 'angry', 'angry', 'panic', 'panic', 'helpless', 'helpless'
    ]);
    expect(moodFor(100, true)).toBe('helpless');
  });

  test('áp hiệu ứng có kẹp 0–100 và cạn sức chịu đựng thì bất lực', () => {
    const b = applyEffect(initialBoss(), { calm: -30, stamina: -150 }, DEFAULT_BOSS, 0, { actionId: 'x', actorName: 'A' });
    expect(b.calm).toBe(70);
    expect(b.stamina).toBe(0);
    expect(b.mood).toBe('helpless');
    expect(b.exhaustedUntil).toBe(DEFAULT_BOSS.exhaustedMs);
  });

  test('hồi phục theo thời gian, không hồi khi đang bất lực', () => {
    const cfg = { ...DEFAULT_BOSS, calmRecoveryPerSec: 1, staminaRecoveryPerSec: 1, exhaustedMs: 5000 };
    let b = applyEffect(initialBoss(), { calm: -50, stamina: -100 }, cfg, 0, { actionId: 'x', actorName: null });
    b = recover(b, cfg, 2000, 2000);
    expect(b.calm).toBe(50);
    b = recover(b, cfg, 10_000, 12_000);
    expect(b.calm).toBe(60);
    expect(b.mood).toBe('annoyed');
  });
});

describe('CollectiveTracker', () => {
  const cfg = { ...defaultGameConfig().collective, goal: 3, restartDelayMs: 1000 };

  test('đủ mục tiêu thì completed một lần, rồi mở vòng mới', () => {
    let n = 0;
    const t = new CollectiveTracker(cfg, () => `r${++n}`);
    t.start(0);
    expect(t.contribute('a', 0)).toBe('progress');
    expect(t.contribute('a', 0)).toBe('progress');
    expect(t.contribute('b', 0)).toBe('completed');
    expect(t.contribute('c', 0)).toBeNull();
    expect(t.current?.participants).toBe(2);
    expect(t.tick(500)).toBeNull();
    const r = t.tick(1000);
    expect(r?.kind).toBe('started');
    expect(t.current?.progress).toBe(0);
    expect(t.current?.roundId).toBe('r2');
  });

  test('hết hạn thì expired', () => {
    const t = new CollectiveTracker({ ...cfg, durationMs: 100 }, () => 'r');
    t.start(0);
    expect(t.tick(100)?.kind).toBe('expired');
  });
});

describe('PlayerRegistry', () => {
  const u = (id: string) => ({ platformId: id, username: id, displayName: id.toUpperCase() });

  test('bảng xếp hạng phiên và tổng, bỏ người chơi demo khỏi bảng tổng và dữ liệu lưu', () => {
    const r = new PlayerRegistry();
    r.participate(u('a'), 5);
    r.participate(u('b'), 10);
    r.participate(u('demo:x'), 50);
    expect(r.leaderboard('session').map((e) => e.platformId)).toEqual(['demo:x', 'b', 'a']);
    expect(r.leaderboard('total').map((e) => e.platformId)).toEqual(['b', 'a']);
    expect(r.takeDirty().map((d) => d.player.platformId).sort()).toEqual(['a', 'b']);
    expect(r.takeDirty()).toHaveLength(0);
    r.resetSession();
    expect(r.participants()).toBe(0);
    expect(r.leaderboard('total')).toHaveLength(2);
  });

  test('danh hiệu', () => {
    const base = { totalPoints: 0, actionCounts: {}, grantedTitles: [] as string[] };
    expect(computeTitle(base)).toBe('Nhân viên chăm chỉ');
    expect(computeTitle({ ...base, actionCounts: { pluck_tree: 3, throw_paper: 2 } })).toBe('Chuyên gia phá deadline');
    expect(computeTitle({ ...base, actionCounts: { spill_coffee: 3, throw_paper: 2 } })).toBe('Chuyên gia phá deadline'); // số liệu cũ
    expect(computeTitle({ ...base, actionCounts: { doodle_kpi: 3 } })).toBe('Trùm họp hành');
    expect(computeTitle({ ...base, actionCounts: { emergency_meeting: 3 } })).toBe('Trùm họp hành'); // số liệu cũ
    expect(computeTitle({ ...base, grantedTitles: ['Nhân viên chống đối'] })).toBe('Nhân viên chống đối');
    expect(computeTitle({ ...base, totalPoints: 300 })).toBe('Kẻ thù của Sếp');
  });
});

describe('đồng bộ hành động đã lưu với code', () => {
  /** Cấu hình kiểu bản cũ: còn emergency_meeting / spill_coffee, thiếu hành động mới, chạy song song 2. */
  function legacyConfig() {
    const c = defaultGameConfig();
    const old = (id: string, lanes: any[]) => ({ ...structuredClone(c.actions[0]!), id, name: id, lanes });
    c.actions = c.actions.filter((a) => !['pluck_tree', 'doodle_kpi', 'blackout'].includes(a.id));
    c.actions.splice(1, 0, old('emergency_meeting', ['boss', 'meeting']), old('spill_coffee', ['desk']));
    c.actions.find((a) => a.id === 'throw_paper')!.cooldownMs = 1234; // admin đã chỉnh
    c.gifts = [
      { giftId: 5655, giftName: 'Rose', actionId: 'throw_paper', minCount: 1, enabled: true },
      { giftId: 7934, giftName: 'Cà phê', actionId: 'emergency_meeting', minCount: 1, enabled: false },
      { giftId: 0, giftName: 'Quà khác', actionId: 'spill_coffee', minCount: 1, enabled: true }
    ];
    c.limits.maxConcurrent = 2;
    return c;
  }

  test('reconcileConfig: bỏ hành động cũ, thêm hành động mới, chuyển mapping quà, ép nối tiếp', () => {
    const r = reconcileConfig(legacyConfig(), defaultGameConfig());
    expect(r.changed).toBe(true);
    expect(r.removed.sort()).toEqual(['emergency_meeting', 'spill_coffee']);
    expect(r.added).toEqual(['pluck_tree', 'doodle_kpi', 'blackout']);
    expect(r.config.actions.map((a) => a.id)).toEqual(DEFAULT_ACTIONS.map((a) => a.id));
    expect(r.config.actions.find((a) => a.id === 'throw_paper')!.cooldownMs).toBe(1234);
    expect(r.remappedGifts).toBe(2);
    expect(r.config.gifts.map((g) => [g.giftId, g.actionId, g.enabled])).toEqual([
      [5655, 'throw_paper', true],
      [7934, 'pluck_tree', false],
      [0, 'pluck_tree', true]
    ]);
    expect(r.config.limits.maxConcurrent).toBe(1);
  });

  test('reconcileConfig: cấu hình đã đúng thì không đổi', () => {
    const r = reconcileConfig(defaultGameConfig(), defaultGameConfig());
    expect(r.changed).toBe(false);
    expect(r.config).toEqual(defaultGameConfig());
  });

  test('MemoryStore.init dọn cấu hình cũ khi khởi động lại', async () => {
    const store = new MemoryStore();
    store.config = legacyConfig();
    await store.init(defaultGameConfig());
    const cfg = await store.loadConfig();
    expect(cfg.actions.map((a) => a.id)).toEqual(DEFAULT_ACTIONS.map((a) => a.id));
    expect(cfg.gifts.every((g) => cfg.actions.some((a) => a.id === g.actionId))).toBe(true);
    expect(cfg.limits.maxConcurrent).toBe(1);
  });
});

describe('nâng cấp cấu hình bản 1 → 2 (trêu Sếp chỉ bằng quà)', () => {
  /** Cấu hình đúng như bản 1 lưu trong DB: không có version, trigger bình luận, mapping quà cũ. */
  function v1Config() {
    const c = defaultGameConfig();
    delete c.version;
    commentTriggers(c);
    c.actions.find((a) => a.id === 'throw_paper')!.trigger.kinds = ['comment', 'like'];
    c.actions.find((a) => a.id === 'blackout')!.trigger.kinds = ['comment', 'share'];
    c.actions.find((a) => a.id === 'crash_pc')!.cooldownMs = 777; // admin đã chỉnh — phải giữ
    c.gifts = [
      { giftId: 5655, giftName: 'Rose', actionId: 'throw_paper', minCount: 1, enabled: true },
      { giftId: 5655, giftName: 'Rose x10', actionId: 'flat_tire', minCount: 10, enabled: true },
      { giftId: 0, giftName: 'Quà khác', actionId: 'pluck_tree', minCount: 1, enabled: true },
      { giftId: 6064, giftName: 'GG', actionId: 'lock_toilet', minCount: 1, enabled: true } // admin tự thêm
    ];
    return c;
  }

  test('bỏ trigger bình luận/like/share, thay quà mặc định cũ bằng bậc kim cương, giữ mapping riêng', () => {
    const r = reconcileConfig(v1Config(), defaultGameConfig());
    expect(r.changed).toBe(true);
    expect(r.upgradedFrom).toBe(1);
    expect(r.config.version).toBe(CONFIG_VERSION);
    for (const a of r.config.actions) expect(a.trigger.kinds).toEqual([]);
    for (const a of r.config.actions) expect(a.trigger.keywords).toEqual([]);
    expect(r.config.actions.find((a) => a.id === 'throw_paper')!.trigger.followersOnly).toBe(true);
    expect(r.config.actions.find((a) => a.id === 'crash_pc')!.cooldownMs).toBe(777);
    expect(r.config.gifts).toEqual([
      { giftId: 6064, giftName: 'GG', actionId: 'lock_toilet', minCount: 1, enabled: true },
      ...DEFAULT_GIFTS
    ]);
  });

  test('mapping riêng trùng giftId với mặc định thì giữ của admin', () => {
    const c = v1Config();
    c.gifts.push({ giftId: 7934, giftName: 'Heart Me', actionId: 'blackout', minCount: 1, enabled: true });
    const r = reconcileConfig(c, defaultGameConfig());
    expect(r.config.gifts.filter((g) => g.giftId === 7934)).toEqual([
      { giftId: 7934, giftName: 'Heart Me', actionId: 'blackout', minCount: 1, enabled: true }
    ]);
  });

  test('chỉ nâng cấp một lần: chỉnh sửa của admin sau đó được giữ qua các lần khởi động', async () => {
    const store = new MemoryStore();
    store.config = v1Config();
    await store.init(defaultGameConfig());
    const upgraded = await store.loadConfig();
    expect(upgraded.version).toBe(CONFIG_VERSION);
    expect(upgraded.actions.every((a) => a.trigger.kinds.length === 0)).toBe(true);

    // Admin bật lại bình luận cho Nịnh Sếp và đổi một bậc quà.
    const edited = structuredClone(upgraded);
    const praise = edited.actions.find((a) => a.id === 'praise_boss')!;
    praise.trigger = { ...praise.trigger, kinds: ['comment'], keywords: LEGACY_COMMENT_KEYWORDS.praise_boss! };
    edited.gifts = edited.gifts.filter((g) => g.actionId !== 'blackout');
    await store.saveConfig(edited);

    await store.init(defaultGameConfig()); // khởi động lại
    const again = await store.loadConfig();
    expect(again).toEqual(edited);
    expect(reconcileConfig(again, defaultGameConfig()).changed).toBe(false);
  });

  test('cấu hình mới (đã đúng phiên bản) không bị đụng tới', () => {
    const c = defaultGameConfig();
    commentTriggers(c);
    const r = reconcileConfig(c, defaultGameConfig());
    expect(r.changed).toBe(false);
    expect(r.upgradedFrom).toBeUndefined();
    expect(r.config.actions.find((a) => a.id === 'throw_paper')!.trigger.kinds).toEqual(['comment']);
  });
});

describe('Bảng xếp hạng phá Sếp theo kim cương', () => {
  const u = (id: string) => ({ platformId: id, username: id, displayName: id.toUpperCase() });

  test('kim cương giảm dần, rồi điểm, rồi lượt tham gia — cả phiên lẫn tổng', () => {
    const r = new PlayerRegistry();
    r.participate(u('a'), 100); // nhiều điểm nhưng không tặng quà
    r.participate(u('b'), 5);
    r.addDiamonds('b', 5);
    r.participate(u('c'), 30);
    r.addDiamonds('c', 30);
    r.participate(u('d'), 1);
    r.participate(u('d'), 1);
    r.participate(u('e'), 1);
    r.addDiamonds('ghost', 999); // chưa tham gia → bỏ qua
    expect(r.leaderboard('session').map((e) => [e.platformId, e.diamonds])).toEqual([
      ['c', 30],
      ['b', 5],
      ['a', 0],
      ['d', 0],
      ['e', 0]
    ]);
    expect(r.leaderboard('total').map((e) => e.platformId)).toEqual(['c', 'b', 'a', 'd', 'e']);
    r.resetSession();
    r.participate(u('a'), 1);
    r.addDiamonds('a', 3);
    expect(r.leaderboard('session').map((e) => [e.platformId, e.diamonds])).toEqual([['a', 3]]);
    expect(r.leaderboard('total').map((e) => [e.platformId, e.diamonds])).toEqual([
      ['c', 30],
      ['b', 5],
      ['a', 3],
      ['d', 0],
      ['e', 0]
    ]);
    const saved = r.takeDirty().find((d) => d.player.platformId === 'a')!;
    expect(saved.player.totalDiamonds).toBe(3);
    expect(saved.session).toEqual({ participations: 1, points: 1, diamonds: 3 });
  });

  test('bản ghi cũ không có totalDiamonds được coi là 0', () => {
    const r = new PlayerRegistry();
    r.load([{ platformId: 'old', username: 'old', displayName: 'Old', totalParticipations: 3, totalPoints: 9, actionCounts: {}, grantedTitles: [] }]);
    expect(r.leaderboard('total')[0]).toMatchObject({ platformId: 'old', diamonds: 0, points: 9 });
  });
});
