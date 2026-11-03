import { describe, expect, test } from 'bun:test';
import { containsKeyword, foldVietnamese, type GameConfig } from '@cau/shared';
import {
  CONFIG_VERSION,
  DEFAULT_ACTIONS,
  DEFAULT_COLLECTIVE,
  DEFAULT_FISHING,
  DEFAULT_GIFTS,
  DEFAULT_KING,
  DEFAULT_WORK,
  LEGACY_ACTION_IDS,
  defaultGameConfig,
  reconcileConfig
} from '../src/config/defaults';
import { applyEffect, initialKing, moodFor, recover } from '../src/engine/king';
import { CollectiveTracker } from '../src/engine/collective';
import { CooldownTracker } from '../src/engine/cooldown';
import { Deduper } from '../src/engine/dedupe';
import { matchAction } from '../src/engine/matcher';
import { ActionQueue } from '../src/engine/queue';
import { RateLimiter } from '../src/engine/rate-limit';
import { AnimationScheduler } from '../src/engine/scheduler';
import { PlayerRegistry } from '../src/players/players';
import { MemoryStore } from '../src/store/memory-store';
import { commentTriggers, ev, testConfig } from './helpers';

describe('text', () => {
  test('foldVietnamese bỏ dấu, chữ thường, ký tự lạ', () => {
    expect(foldVietnamese('Thay MỒI-GIUN!!')).toBe('thay moi giun');
    expect(foldVietnamese('  Trà   ĐÁ 🍵 ')).toBe('tra da');
  });
  test('containsKeyword theo ranh giới từ', () => {
    expect(containsKeyword('uong tra da di', 'trà đá')).toBe(true);
    expect(containsKeyword('hat ho', 'hat khan')).toBe(false);
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
  const item = (actionId: string, priority: number, lanes: any[] = ['king']) => ({ actionId, priority, lanes, enqueuedAt: 0, payload: null });

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
    q.push(item('king', 5, ['king']));
    q.push(item('sky', 1, ['sky']));
    expect(q.popRunnable(new Set(['king']))?.actionId).toBe('sky');
  });

  test('mục ưu tiên cao bị chặn sẽ giữ chỗ lane, không bị chen', () => {
    const q = new ActionQueue(10);
    q.push(item('grand_haul', 100, ['king', 'sky']));
    q.push(item('sky', 1, ['sky']));
    q.push(item('dock', 1, ['dock']));
    // king bận -> grand_haul chưa chạy được, sky bị giữ chỗ, dock vẫn chạy được
    expect(q.popRunnable(new Set(['king']))?.actionId).toBe('dock');
    expect(q.popRunnable(new Set(['king']))).toBeNull();
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
    expect(q.pending().map((i) => i.actionId)).toEqual(['b', 'd']);
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
    s.start(run('a', ['king']));
    expect(s.canRun(['king'])).toBe(false);
    expect(s.canRun(['sky'])).toBe(true);
    s.start(run('b', ['sky']));
    expect(s.canRun(['dock'])).toBe(false); // vượt giới hạn 2
    expect(() => s.start(run('c', ['dock']))).toThrow();
  });

  test('kết thúc đúng thời lượng', () => {
    const s = new AnimationScheduler(2);
    s.start(run('a', ['king'], 0, 1000));
    expect(s.finishDue(999)).toHaveLength(0);
    expect(s.finishDue(1000).map((r) => r.runId)).toEqual(['a']);
    expect(s.size).toBe(0);
  });
});

describe('matcher', () => {
  // Cơ chế so khớp bình luận vẫn còn (admin bật lại được) — thử với trigger bình luận số 1–9.
  const { actions, gifts } = testConfig(commentTriggers);

  test('mặc định: bình luận / like / share không kích hoạt kéo cá to', () => {
    const d = defaultGameConfig();
    for (const text of ['1', '4', '9', 'kéo cá chép', 'cá lăng', 'cá koi']) {
      expect(matchAction(ev({ kind: 'comment', text }), d.actions, d.gifts)).toBeNull();
    }
    expect(matchAction(ev({ kind: 'like', likeCount: 10 }), d.actions, d.gifts)).toBeNull();
    expect(matchAction(ev({ kind: 'share' }), d.actions, d.gifts)).toBeNull();
    expect(matchAction(ev({ kind: 'follow' }), d.actions, d.gifts)).toBeNull();
  });

  test('bình luận theo từ khoá và số', () => {
    expect(matchAction(ev({ kind: 'comment', text: 'Kéo cá chép đi anh em' }), actions, gifts)?.action.id).toBe('pull_carp');
    expect(matchAction(ev({ kind: 'comment', text: 'cá trê!!' }), actions, gifts)?.action.id).toBe('pull_catfish');
    expect(matchAction(ev({ kind: 'comment', text: '9' }), actions, gifts)?.action.id).toBe('pull_legend');
    expect(matchAction(ev({ kind: 'comment', text: '4' }), actions, gifts)?.action.id).toBe('pull_stingray');
    expect(matchAction(ev({ kind: 'comment', text: 'chào mọi người' }), actions, gifts)).toBeNull();
  });

  test('bình luận khớp nhiều từ khoá thì chọn từ khoá dài nhất', () => {
    expect(matchAction(ev({ kind: 'comment', text: '1 cá thần huyền thoại' }), actions, gifts)?.action.id).toBe('pull_legend');
  });

  test('quà theo bậc kim cương mặc định (giá trị = kim cương × số lượng)', () => {
    const gift = (diamonds: number, count = 1, giftId = 9999) => ev({ kind: 'gift', gift: { giftId, name: 'g', count, diamonds } });
    const at = (diamonds: number, count = 1, giftId = 9999) => matchAction(gift(diamonds, count, giftId), actions, gifts)?.action.id;
    expect(at(1)).toBe('pull_carp');
    expect(at(4)).toBe('pull_carp');
    expect(at(5)).toBe('pull_grass_carp');
    expect(at(1, 5, 5655)).toBe('pull_grass_carp'); // Rose ×5
    expect(at(1, 10, 5655)).toBe('pull_catfish'); // Rose ×10
    expect(at(20)).toBe('pull_catfish'); // Perfume
    expect(at(30)).toBe('pull_snakehead'); // Doughnut
    expect(at(99)).toBe('pull_giant_catfish'); // Hat and Mustache
    expect(at(99, 2)).toBe('pull_giant_catfish'); // 198 < 199
    expect(at(99, 3)).toBe('pull_arowana'); // 297
    expect(at(299)).toBe('pull_stingray');
    expect(at(498)).toBe('pull_stingray');
    expect(at(499)).toBe('pull_legend');
    expect(at(500)).toBe('pull_legend'); // Money Gun
    expect(at(34_999)).toBe('pull_legend'); // quà rất to vẫn là bậc cao nhất
  });

  test('giftId cụ thể thắng trước; không rõ giá trị thì lấy bậc thấp nhất', () => {
    const g = (giftId: number, diamonds: number, count = 1) => ev({ kind: 'gift', gift: { giftId, name: 'g', count, diamonds } });
    expect(matchAction(g(7934, 1), actions, gifts)?.action.id).toBe('pull_koi'); // Heart Me
    expect(matchAction(g(7934, 1, 600), actions, gifts)?.action.id).toBe('pull_koi'); // vẫn là mapping riêng
    expect(matchAction(g(1234, 0), actions, gifts)?.action.id).toBe('pull_carp');
    expect(matchAction(g(1234, 0, 50), actions, gifts)?.action.id).toBe('pull_carp');
  });

  test('bậc tuỳ chỉnh: minCount, bậc bị tắt, giá trị dưới mọi bậc, mapping riêng có minDiamonds', () => {
    const custom = [
      { giftId: 0, giftName: 'a', actionId: 'pull_grass_carp', minCount: 1, minDiamonds: 10, enabled: true },
      { giftId: 0, giftName: 'b', actionId: 'pull_legend', minCount: 1, minDiamonds: 100, enabled: false },
      { giftId: 0, giftName: 'c', actionId: 'pull_giant_catfish', minCount: 5, minDiamonds: 50, enabled: true },
      { giftId: 0, giftName: 'd', actionId: 'pull_catfish', minCount: 1, minDiamonds: 50, enabled: true },
      { giftId: 42, giftName: 'riêng', actionId: 'pull_arowana', minCount: 1, minDiamonds: 200, enabled: true }
    ];
    const at = (giftId: number, diamonds: number, count = 1) =>
      matchAction(ev({ kind: 'gift', gift: { giftId, name: 'g', count, diamonds } }), actions, custom)?.action.id ?? null;
    expect(at(1, 9)).toBeNull(); // dưới mọi bậc
    expect(at(1, 10)).toBe('pull_grass_carp');
    expect(at(1, 500)).toBe('pull_catfish'); // bậc 100 bị tắt; 50 với minCount 1 (count=1 < 5)
    expect(at(1, 10, 5)).toBe('pull_giant_catfish'); // 50 kim cương, count 5: hoà minDiamonds → minCount cao hơn thắng
    expect(at(1, 0)).toBe('pull_grass_carp'); // không rõ giá trị → bậc thấp nhất
    expect(at(42, 100, 2)).toBe('pull_arowana'); // mapping riêng đủ mốc
    expect(at(42, 100)).toBe('pull_catfish'); // mapping riêng chưa đủ mốc → rơi về bậc giftId 0
  });

  test('mapping quà bị tắt thì không khớp', () => {
    const off = gifts.map((g) => ({ ...g, enabled: false }));
    expect(matchAction(ev({ kind: 'gift', gift: { giftId: 5655, name: 'Rose', count: 1, diamonds: 1 } }), actions, off)).toBeNull();
  });
});

describe('Cá Thần (king)', () => {
  test('ngưỡng tâm trạng', () => {
    expect([100, 80, 79, 60, 59, 35, 34, 15, 14, 0].map((c) => moodFor(c, false))).toEqual([
      'calm', 'calm', 'curious', 'curious', 'agitated', 'agitated', 'thrashing', 'thrashing', 'exhausted', 'exhausted'
    ]);
    expect(moodFor(100, true)).toBe('exhausted');
  });

  test('áp tác động có kẹp 0–100 và cạn sức bền thì kiệt sức', () => {
    const b = applyEffect(initialKing(), { calm: -30, stamina: -150 }, DEFAULT_KING, 0, { actionId: 'x', actorName: 'A' });
    expect(b.calm).toBe(70);
    expect(b.stamina).toBe(0);
    expect(b.mood).toBe('exhausted');
    expect(b.exhaustedUntil).toBe(DEFAULT_KING.exhaustedMs);
  });

  test('hồi phục theo thời gian, không hồi khi đang kiệt sức', () => {
    const cfg = { ...DEFAULT_KING, calmRecoveryPerSec: 1, staminaRecoveryPerSec: 1, exhaustedMs: 5000 };
    let b = applyEffect(initialKing(), { calm: -50, stamina: -100 }, cfg, 0, { actionId: 'x', actorName: null });
    b = recover(b, cfg, 2000, 2000);
    expect(b.calm).toBe(50);
    b = recover(b, cfg, 10_000, 12_000);
    expect(b.calm).toBe(60);
    expect(b.mood).toBe('curious');
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

  test('BẢNG CÂN CÁ: theo gram, cá ≥ 10 kg đếm big_catch, lưu gram xuống bản ghi', () => {
    const r = new PlayerRegistry();
    r.participate(u('a'), 1);
    r.participate(u('b'), 1);
    r.creditFish('a', 1.2, 2, 'catch');
    r.creditFish('b', 12.3, 0);
    r.creditFish('a', 0.3, 0, 'catch');
    expect(r.kgBoard('session').map((e) => [e.platformId, e.kg])).toEqual([
      ['b', 12.3],
      ['a', 1.5]
    ]);
    expect(r.get('b')?.actionCounts.big_catch).toBe(1);
    expect(r.get('a')?.actionCounts).toEqual({ catch: 2 });
    const saved = r.takeDirty().find((d) => d.player.platformId === 'a')!;
    expect(saved.player.totalGrams).toBe(1500);
    expect(saved.session).toEqual({ participations: 1, points: 3, diamonds: 0, grams: 1500 });
  });
});

describe('Bảng TOP QUÀ TẶNG theo kim cương', () => {
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
    const saved = r.takeDirty().find((d) => d.player.platformId === 'a')!;
    expect(saved.player.totalDiamonds).toBe(3);
    expect(saved.session).toEqual({ participations: 1, points: 1, diamonds: 3, grams: 0 });
  });

  test('bản ghi cũ không có totalDiamonds / totalGrams được coi là 0', () => {
    const r = new PlayerRegistry();
    r.load([{ platformId: 'old', username: 'old', displayName: 'Old', totalParticipations: 3, totalPoints: 9, actionCounts: {}, grantedTitles: [] }]);
    expect(r.leaderboard('total')[0]).toMatchObject({ platformId: 'old', diamonds: 0, kg: 0, points: 9, title: 'Cần thủ tập sự' });
  });
});

describe('đồng bộ hành động đã lưu với code (bản hiện tại)', () => {
  /** Cấu hình bản 3 nhưng còn hành động lạ, thiếu vài hành động, chạy song song 2. */
  function driftedConfig() {
    const c = defaultGameConfig();
    const old = (id: string) => ({ ...structuredClone(c.actions[0]!), id, name: id });
    c.actions = c.actions.filter((a) => !['pull_grass_carp', 'pull_catfish', 'pull_legend'].includes(a.id));
    c.actions.splice(1, 0, old('thu_nghiem'), old('bo_roi'));
    c.actions.find((a) => a.id === 'pull_carp')!.cooldownMs = 1234; // admin đã chỉnh
    c.gifts = [
      { giftId: 5655, giftName: 'Rose', actionId: 'pull_carp', minCount: 1, enabled: true },
      { giftId: 7934, giftName: 'Heart Me', actionId: 'thu_nghiem', minCount: 1, enabled: false },
      { giftId: 0, giftName: 'Quà khác', actionId: 'bo_roi', minCount: 1, enabled: true }
    ];
    c.limits.maxConcurrent = 2;
    return c;
  }

  test('reconcileConfig: bỏ hành động lạ, thêm hành động thiếu, chuyển mapping quà, ép nối tiếp', () => {
    const r = reconcileConfig(driftedConfig(), defaultGameConfig());
    expect(r.changed).toBe(true);
    expect(r.upgradedFrom).toBeUndefined();
    expect(r.removed.sort()).toEqual(['bo_roi', 'thu_nghiem']);
    expect(r.added).toEqual(['pull_grass_carp', 'pull_catfish', 'pull_legend']);
    expect(r.config.actions.map((a) => a.id)).toEqual(DEFAULT_ACTIONS.map((a) => a.id));
    expect(r.config.actions.find((a) => a.id === 'pull_carp')!.cooldownMs).toBe(1234);
    expect(r.remappedGifts).toBe(2);
    expect(r.config.gifts.map((g) => [g.giftId, g.actionId, g.enabled])).toEqual([
      [5655, 'pull_carp', true],
      [7934, 'pull_grass_carp', false],
      [0, 'pull_grass_carp', true]
    ]);
    expect(r.config.limits.maxConcurrent).toBe(1);
  });

  test('reconcileConfig: cấu hình đã đúng thì không đổi', () => {
    const r = reconcileConfig(defaultGameConfig(), defaultGameConfig());
    expect(r.changed).toBe(false);
    expect(r.config).toEqual(defaultGameConfig());
  });

  test('fishing thiếu trường mới thì bổ sung mặc định, giữ phần admin đã chỉnh', () => {
    const c = defaultGameConfig();
    const partial = { ...c.fishing, tickMs: 7000 } as Partial<typeof c.fishing>;
    delete partial.catchesPerTick;
    delete partial.bigFishShadowMs;
    c.fishing = partial as typeof c.fishing;
    const r = reconcileConfig(c, defaultGameConfig());
    expect(r.changed).toBe(true);
    expect(r.config.fishing).toEqual({ ...DEFAULT_FISHING, tickMs: 7000 });
  });

  test('MemoryStore.init dọn cấu hình lệch khi khởi động lại', async () => {
    const store = new MemoryStore();
    store.config = driftedConfig();
    await store.init(defaultGameConfig());
    const cfg = await store.loadConfig();
    expect(cfg.actions.map((a) => a.id)).toEqual(DEFAULT_ACTIONS.map((a) => a.id));
    expect(cfg.gifts.every((g) => cfg.actions.some((a) => a.id === g.actionId))).toBe(true);
    expect(cfg.limits.maxConcurrent).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Nâng cấp cấu hình chủ đề cũ (bản ≤ 2) lên bản 3
// ----------------------------------------------------------------------------

type OldAction = Omit<GameConfig['actions'][number], 'kingEffect' | 'fish' | 'lanes'> & {
  lanes: string[];
  bossEffect: { calm: number; stamina: number };
};

/** Hành động đúng như bản 2 lưu: id cũ, lane cũ, `bossEffect`. */
function oldAction(id: string, name: string, priority: number, cooldownMs: number, lanes: string[], points: number): OldAction {
  return {
    id,
    name,
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 7000,
    cooldownMs,
    userCooldownMs: 30000,
    priority,
    lanes,
    bossEffect: { calm: -7, stamina: -3 },
    points
  };
}

/** Cấu hình bản 2 (chủ đề cũ) y như lưu trong DB / MemoryStore: khoá `boss`, không có `fishing`. */
function v2Config(): GameConfig {
  const actions: OldAction[] = [
    oldAction('throw_paper', 'Ném giấy', 10, 4000, ['boss'], 5),
    oldAction('pluck_tree', 'Vặt lá', 15, 15000, ['boss'], 10),
    oldAction('doodle_kpi', 'Vẽ bảng', 15, 15000, ['boss'], 10),
    oldAction('flat_tire', 'Xịt lốp', 25, 25000, ['car', 'boss', 'desk', 'meeting', 'toilet'], 12),
    oldAction('lock_toilet', 'Khoá cửa', 25, 30000, ['boss', 'toilet'], 12),
    oldAction('crash_pc', 'Treo máy', 20, 777, ['boss', 'desk'], 10), // admin đã chỉnh cooldown
    oldAction('complaint_call', 'Gọi điện', 20, 20000, ['boss'], 10),
    { ...oldAction('praise_boss', 'Khen', 10, 15000, ['boss'], 3), trigger: { kinds: [], keywords: [] } },
    { ...oldAction('blackout', 'Tắt điện', 25, 25000, ['boss', 'desk'], 12), enabled: false }, // admin đã tắt
    { ...oldAction('strike', 'Nghỉ làm', 1000, 0, ['boss', 'desk', 'car', 'meeting', 'toilet', 'staff'], 0), trigger: { kinds: [], keywords: [] } }
  ];
  return {
    version: 2,
    actions,
    gifts: [
      { giftId: 7934, giftName: 'Heart Me', actionId: 'praise_boss', minCount: 1, minDiamonds: 0, enabled: true },
      { giftId: 0, giftName: 'Từ 1 kim cương', actionId: 'throw_paper', minCount: 1, minDiamonds: 1, enabled: true },
      { giftId: 0, giftName: 'Từ 499 kim cương', actionId: 'blackout', minCount: 1, minDiamonds: 499, enabled: true },
      { giftId: 6064, giftName: 'GG', actionId: 'lock_toilet', minCount: 1, minDiamonds: 0, enabled: true } // admin tự thêm
    ],
    boss: { calmRecoveryPerSec: 0.5, staminaRecoveryPerSec: 0.2, exhaustedMs: 9000 }, // admin đã chỉnh
    collective: { enabled: true, name: 'Tên cũ', description: 'Mô tả cũ', goal: 150, durationMs: 0, restartDelayMs: 20000, actionId: 'strike', rewardTitle: 'Danh hiệu cũ' },
    limits: { ...defaultGameConfig().limits },
    work: [{ id: 'lam_viec', name: 'Việc cũ', enabled: true, keywords: ['lam viec'], emoji: '⌨️', text: 'cũ', points: 2, userCooldownMs: 20000 }]
  } as unknown as GameConfig;
}

describe('nâng cấp cấu hình bản 2 → 3 (chủ đề câu cá)', () => {
  test('đổi id hành động cũ sang id mới, giữ chỉnh sửa admin, đặt lại tên/lane/cá', () => {
    const r = reconcileConfig(v2Config(), defaultGameConfig());
    expect(r.changed).toBe(true);
    expect(r.upgradedFrom).toBe(2);
    expect(r.config.version).toBe(CONFIG_VERSION);
    expect(CONFIG_VERSION).toBe(3);
    expect(r.removed.sort()).toEqual(Object.keys(LEGACY_ACTION_IDS).sort()); // dòng id cũ cần xoá khỏi DB
    expect(r.config.actions.map((a) => a.id)).toEqual(DEFAULT_ACTIONS.map((a) => a.id));
    expect(r.added).toEqual(['big_fish_event']); // không có bậc cũ tương ứng

    const byId = new Map(r.config.actions.map((a) => [a.id, a]));
    const net = byId.get('pull_giant_catfish')!; // từ crash_pc
    const def = DEFAULT_ACTIONS.find((a) => a.id === 'pull_giant_catfish')!;
    expect(net).toMatchObject({ name: def.name, lanes: def.lanes, fish: def.fish, durationMs: def.durationMs, cooldownMs: 777, priority: 20 });
    expect(byId.get('pull_legend')!.enabled).toBe(false); // từ blackout (admin đã tắt)
    for (const a of r.config.actions) {
      expect(a.kingEffect).toBeDefined();
      expect((a as unknown as { bossEffect?: unknown }).bossEffect).toBeUndefined();
      for (const l of a.lanes) expect(['king', 'lake', 'dock', 'sky', 'underwater', 'anglers']).toContain(l);
    }
  });

  test('mapping quà + sự kiện tập thể đổi actionId; king lấy từ boss; work/fishing/collective theo mặc định mới', () => {
    const r = reconcileConfig(v2Config(), defaultGameConfig());
    expect(r.config.gifts.map((g) => [g.giftId, g.actionId])).toEqual([
      [7934, 'pull_koi'],
      [0, 'pull_carp'],
      [0, 'pull_legend'],
      [6064, 'pull_arowana']
    ]);
    expect(r.remappedGifts).toBe(0);
    expect(r.config.king).toEqual({ calmRecoveryPerSec: 0.5, staminaRecoveryPerSec: 0.2, exhaustedMs: 9000 });
    expect((r.config as unknown as { boss?: unknown }).boss).toBeUndefined();
    expect(r.config.work).toEqual(DEFAULT_WORK);
    expect(r.config.fishing).toEqual(DEFAULT_FISHING);
    expect(r.config.collective).toEqual({
      ...DEFAULT_COLLECTIVE,
      goal: 150,
      restartDelayMs: 20000,
      actionId: 'grand_haul'
    });
  });

  test('store đã chèn sẵn hành động mặc định (kiểu PgStore) — bản đổi từ id cũ vẫn thắng', () => {
    const c = v2Config();
    c.actions.push(...structuredClone(DEFAULT_ACTIONS)); // PgStore.init chèn mặc định trước khi reconcile
    const r = reconcileConfig(c, defaultGameConfig());
    expect(r.config.actions.map((a) => a.id)).toEqual(DEFAULT_ACTIONS.map((a) => a.id));
    expect(r.config.actions.find((a) => a.id === 'pull_giant_catfish')!.cooldownMs).toBe(777);
    expect(r.config.actions.find((a) => a.id === 'pull_legend')!.enabled).toBe(false);
  });

  test('MemoryStore: nâng cấp một lần, chỉnh sửa sau đó của admin được giữ qua các lần khởi động', async () => {
    const store = new MemoryStore();
    store.config = v2Config();
    await store.init(defaultGameConfig());
    const upgraded = await store.loadConfig();
    expect(upgraded.version).toBe(3);
    expect(upgraded.actions.map((a) => a.id)).toEqual(DEFAULT_ACTIONS.map((a) => a.id));

    const edited = structuredClone(upgraded);
    edited.work = [];
    edited.fishing.tickMs = 9000;
    edited.collective.name = 'Tên admin đặt';
    await store.saveConfig(edited);

    await store.init(defaultGameConfig()); // khởi động lại
    const again = await store.loadConfig();
    expect(again).toEqual(edited);
    expect(reconcileConfig(again, defaultGameConfig()).changed).toBe(false);
  });
});

describe('nâng cấp cấu hình bản 1 → 3', () => {
  /** Bản 1: không có version, trigger bình luận, mapping quà Rose / Rose x10 / giftId 0 cũ. */
  function v1Config(): GameConfig {
    const c = v2Config();
    delete c.version;
    for (const a of c.actions) a.trigger = { ...a.trigger, kinds: ['comment'], keywords: ['1'] };
    c.gifts = [
      { giftId: 5655, giftName: 'Rose', actionId: 'throw_paper', minCount: 1, enabled: true },
      { giftId: 5655, giftName: 'Rose x10', actionId: 'flat_tire', minCount: 10, enabled: true },
      { giftId: 0, giftName: 'Quà khác', actionId: 'pluck_tree', minCount: 1, enabled: true },
      { giftId: 6064, giftName: 'GG', actionId: 'lock_toilet', minCount: 1, enabled: true } // admin tự thêm
    ];
    return c;
  }

  test('bỏ trigger bình luận, thay quà mặc định cũ bằng bậc kim cương mới, giữ mapping riêng (đổi id)', () => {
    const r = reconcileConfig(v1Config(), defaultGameConfig());
    expect(r.upgradedFrom).toBe(1);
    expect(r.config.version).toBe(CONFIG_VERSION);
    for (const a of r.config.actions) {
      expect(a.trigger.kinds).toEqual([]);
      expect(a.trigger.keywords).toEqual([]);
    }
    expect(r.config.actions.find((a) => a.id === 'pull_giant_catfish')!.cooldownMs).toBe(777);
    expect(r.config.gifts).toEqual([
      { giftId: 6064, giftName: 'GG', actionId: 'pull_arowana', minCount: 1, enabled: true },
      ...DEFAULT_GIFTS
    ]);
  });
});
