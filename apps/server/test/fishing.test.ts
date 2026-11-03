import { describe, expect, test } from 'bun:test';
import { ROSTER_MAX, type LootItem, type RosterMember } from '@cau/shared';
import { ManualClock } from '../src/engine/clock';
import { CATCH_BASE_POINTS, GameEngine } from '../src/engine/engine';
import { DEFAULT_LOOT } from '../src/config/defaults';

import { fillCatchText, gramsToKg, kgToGrams, pickLoot, rollKg } from '../src/engine/loot';
import { PlayerRegistry, TITLES, computeTitle } from '../src/players/players';
import { ev, giftEv, makeEngine, testConfig } from './helpers';

const comment = (text: string, user: string, follower = false) => ev({ kind: 'comment', text }, user, follower);
/** Random lần lượt trả các giá trị cho sẵn (lặp lại). */
const sequence = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

describe('loot', () => {
  const loot: LootItem[] = [
    { emoji: 'a', name: 'A', weight: 1, minKg: 1, maxKg: 2, points: 0 },
    { emoji: 'b', name: 'B', weight: 3, minKg: 0, maxKg: 0, points: 5 },
    { emoji: 'x', name: 'Không bao giờ', weight: 0, minKg: 9, maxKg: 9, points: 0 }
  ];

  test('bốc theo trọng số, bỏ món trọng số 0', () => {
    expect(pickLoot(loot, sequence(0, 0))!.item.name).toBe('A'); // r = 0 < 1
    expect(pickLoot(loot, sequence(0.24, 0))!.item.name).toBe('A'); // 0.96 < 1
    expect(pickLoot(loot, sequence(0.25, 0))!.item.name).toBe('B'); // 1.0 → B
    expect(pickLoot(loot, sequence(0.9999, 0))!.item.name).toBe('B');
    expect(pickLoot([], Math.random)).toBeNull();
    expect(pickLoot([{ ...loot[2]! }], Math.random)).toBeNull();
    // phân bố xấp xỉ 1:3
    let x = 7;
    const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
    const n = { A: 0, B: 0 } as Record<string, number>;
    for (let i = 0; i < 4000; i++) n[pickLoot(loot, rnd)!.item.name]! += 1;
    expect(n.A! / 4000).toBeGreaterThan(0.2);
    expect(n.A! / 4000).toBeLessThan(0.3);
  });

  test('cân trong [min, max], làm tròn 1 chữ số; rác = 0', () => {
    expect(rollKg(1, 2, () => 0)).toBe(1);
    expect(rollKg(1, 2, () => 0.999999)).toBe(2);
    expect(rollKg(0.1, 0.5, () => 0.33)).toBe(0.2);
    expect(rollKg(5, 3, () => 0.5)).toBe(4); // đảo nếu ngược
    expect(rollKg(0, 0, () => 0.7)).toBe(0);
    for (let i = 0; i < 200; i++) {
      const kg = pickLoot(DEFAULT_LOOT, Math.random)!.catch.kg;
      expect(kg).toBeGreaterThanOrEqual(0);
      expect(kg).toBeLessThanOrEqual(30);
      expect(Math.round(kg * 10) / 10).toBe(kg);
    }
    expect(kgToGrams(1.5)).toBe(1500);
    expect(gramsToKg(1549)).toBe(1.5);
  });

  test('điền câu nói', () => {
    expect(fillCatchText('Dính rồi! {name} {kg}kg', { emoji: '', name: 'Cá chép', kg: 1.5 })).toBe('Dính rồi! Cá chép 1,5kg');
    expect(fillCatchText('Dính rồi! {name} {kg}kg', { emoji: '', name: 'Chiếc ủng rách', kg: 0 })).toBe('Dính rồi! Chiếc ủng rách');
  });
});

describe('Câu tự động mỗi chu kỳ', () => {
  test('bình luận / quà → vào hồ; mỗi 5 giây đúng 1 con cá cắn câu, lần lượt theo thứ tự vào hồ', () => {
    const { engine, clock, of } = makeEngine();
    engine.ingest(comment('chào cả hồ', 'a'));
    engine.ingest(comment('hi', 'b'));
    engine.ingest(ev({ kind: 'like', likeCount: 3 }, 'x')); // thả tim thì không vào hồ
    expect(engine.snapshot().roster.map((m) => m.platformId).sort()).toEqual(['a', 'b']);

    clock.advance(4999);
    engine.tick();
    expect(of('catches')).toHaveLength(0);
    clock.advance(1);
    engine.tick();
    // random 0.5 → trọng số 50/100 → Cá chép, 0.5 + 0.5 × 2.5 = 1.8 kg (làm tròn 1.75)
    expect(of('catches')).toEqual([[{ platformId: 'a', displayName: 'User a', emoji: '🐠', name: 'Cá chép', kg: 1.8, at: clock.now() }]]);
    const a = engine.snapshot().roster.find((m) => m.platformId === 'a')!;
    expect(a).toMatchObject({ kg: 1.8, fishingMs: 5000 });
    expect(engine.snapshot().roster.find((m) => m.platformId === 'b')).toMatchObject({ kg: 0, fishingMs: 5000 }); // ngồi vẫn tính giờ
    // 1 điểm bình luận + (CATCH_BASE_POINTS + 1 điểm thưởng cá chép)
    expect(a.points).toBe(1 + CATCH_BASE_POINTS + 1);
    expect(engine.players.get('a')?.actionCounts.catch).toBe(1);

    const turns = () => of('catches').map((batch) => batch.map((c) => c.platformId).join('+'));
    clock.advance(5000);
    engine.tick(); // b
    engine.ingest(giftEv('c', 0)); // quà (không rõ giá) cũng vào hồ — xếp cuối
    clock.advance(5000);
    engine.tick(); // c
    clock.advance(5000);
    engine.tick(); // quay lại a
    expect(turns()).toEqual(['a', 'b', 'c', 'a']);
    expect(engine.snapshot().kgBoard.find((e) => e.platformId === 'a')?.kg).toBe(3.6);
  });

  test('catchesPerTick > 1: nhiều con mỗi chu kỳ, vẫn xoay vòng và không ai được 2 con trong một chu kỳ', () => {
    const { engine, clock, of } = makeEngine((c) => {
      c.fishing.catchesPerTick = 2;
    });
    for (const id of ['a', 'b', 'c']) engine.ingest(comment('hi', id));
    for (let i = 0; i < 3; i++) {
      clock.advance(5000);
      engine.tick();
    }
    expect(of('catches').map((b) => b.map((c) => c.platformId))).toEqual([
      ['a', 'b'],
      ['c', 'a'],
      ['b', 'c']
    ]);
    const solo = makeEngine((c) => {
      c.fishing.catchesPerTick = 5;
    });
    solo.engine.ingest(comment('hi', 'z'));
    solo.clock.advance(5000);
    solo.engine.tick();
    expect(solo.of('catches')).toHaveLength(1);
    expect(solo.of('catches')[0]).toHaveLength(1);
  });

  test('xoay vòng giữ đúng thứ tự khi người rời hồ / vào mới / quay lại', () => {
    const r = new PlayerRegistry();
    const u = (id: string) => ({ platformId: id, username: id, displayName: id });
    const enter = (id: string, now: number) => {
      r.participate(u(id), 1);
      r.join(id, now);
    };
    enter('a', 0);
    enter('b', 0);
    enter('c', 100);
    enter('d', 100);
    expect([r.nextInTurn(), r.nextInTurn()]).toEqual(['a', 'b']);
    r.kickIdle(200, 150); // a, b ngồi không quá lâu → rời hồ
    expect(r.nextInTurn()).toBe('c');
    enter('e', 200); // người mới xếp cuối
    expect([r.nextInTurn(), r.nextInTurn(), r.nextInTurn()]).toEqual(['d', 'e', 'c']);
    enter('a', 300); // quay lại hồ → xếp cuối
    r.kickIdle(400, 250); // c, d (lần cuối lúc 100) rời; e (200), a (300) ở lại
    expect([r.nextInTurn(), r.nextInTurn(), r.nextInTurn()]).toEqual(['e', 'a', 'e']);
    r.resetSession();
    expect(r.nextInTurn()).toBeNull();
  });

  test('không ai ngồi / game dừng thì không câu', () => {
    const { engine, clock, of } = makeEngine();
    clock.advance(5000);
    engine.tick();
    engine.ingest(comment('hi', 'a'));
    engine.stop();
    clock.advance(10_000);
    engine.tick();
    expect(of('catches')).toHaveLength(0);
  });

  test('ngồi không quá idleKickMs thì rời hồ; bình luận lại thì quay lại', () => {
    const { engine, clock } = makeEngine((c) => {
      c.fishing.idleKickMs = 60_000;
    });
    engine.ingest(comment('hi', 'a'));
    clock.advance(30_000);
    engine.ingest(comment('hi', 'b'));
    clock.advance(30_001);
    engine.tick();
    expect(engine.snapshot().roster.map((m) => m.platformId)).toEqual(['b']);
    engine.ingest(comment('về rồi', 'a'));
    expect(engine.snapshot().roster.map((m) => m.platformId).sort()).toEqual(['a', 'b']);
  });

  test(`hồ đầy (${ROSTER_MAX}): người lâu không hoạt động nhất rời, người mới vào chỗ`, () => {
    const { engine } = makeEngine();
    for (let i = 0; i < ROSTER_MAX; i++) engine.ingest(comment('hi', `p${i}`));
    engine.ingest(comment('lại đây', 'p0')); // p0 vừa hoạt động → p1 là người lâu nhất
    engine.ingest(comment('cho ngồi với', 'new'));
    const ids = engine.snapshot().roster.map((m) => m.platformId);
    expect(ids).toHaveLength(ROSTER_MAX);
    expect(ids).toContain('new');
    expect(ids).toContain('p0');
    expect(ids).not.toContain('p1');
  });
});

describe('Chỗ ngồi: chiếu giữa + hai bờ', () => {
  const u = (id: string) => ({ platformId: id, username: id, displayName: id });

  test('chiếu giữa = top quà trong phiên, hoà thì câu lâu hơn; còn lại chia đều hai bờ', () => {
    const r = new PlayerRegistry();
    r.frontSeats = 2;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      r.participate(u(id), 1);
      r.join(id, 0);
    }
    r.addDiamonds('c', 10);
    r.addDiamonds('f', 99);
    let roster = r.roster();
    expect(roster.filter((m) => m.seat === 'front').map((m) => m.platformId)).toEqual(['f', 'c']);
    // Không ai tặng: câu lâu hơn ngồi chiếu giữa
    const r2 = new PlayerRegistry();
    r2.frontSeats = 1;
    for (const id of ['x', 'y']) {
      r2.participate(u(id), 1);
      r2.join(id, 0);
    }
    r2.addFishingMs(['y'], 5000);
    expect(r2.roster()[0]).toMatchObject({ platformId: 'y', seat: 'front' });

    const sides = (list = roster) => ({
      left: list.filter((m) => m.seat === 'left').length,
      right: list.filter((m) => m.seat === 'right').length
    });
    expect(Math.abs(sides().left - sides().right)).toBeLessThanOrEqual(1);
    const before = new Map(roster.map((m) => [m.platformId, m.seat]));
    roster = r.roster();
    expect(new Map(roster.map((m) => [m.platformId, m.seat]))).toEqual(before); // ổn định giữa các lần tính
  });

  test('tặng quà lọt top → lên chiếu giữa NGAY lúc nhận quà (roster phát liền, số liệu mới nhất)', () => {
    // Gom leaderboard/feed/roster rất thưa (1 phút) — đường flush thường không thể phát kịp.
    const clock = new ManualClock();
    const engine = new GameEngine({
      clock,
      config: testConfig((c) => {
        c.fishing.frontSeats = 2;
      }),
      random: () => 0.5,
      broadcastIntervalMs: 60_000
    });
    const rosterMsgs: RosterMember[][] = [];
    engine.subscribe((m) => m.type === 'roster' && rosterMsgs.push(m.data));
    engine.start('s');
    for (const id of ['a', 'b', 'c', 'd']) engine.ingest(comment('hi', id));
    clock.advance(5000);
    engine.tick(); // một chu kỳ: mọi người ngồi được 5000 ms
    engine.ingest(giftEv('a', 5));
    const before = rosterMsgs.length;
    engine.ingest(giftEv('d', 30)); // d lọt top 2, cùng mốc thời gian, không tick
    const rosters = rosterMsgs.slice(before);
    expect(rosters).toHaveLength(1);
    // Có tin roster phát ngay trong lúc nhận quà, d đứng đầu chiếu giữa
    const first = rosters[0]!;
    expect(first.filter((m) => m.seat === 'front').map((m) => m.platformId)).toEqual(['d', 'a']);
    expect(first.find((m) => m.platformId === 'd')).toMatchObject({ seat: 'front', diamonds: 30, fishingMs: 5000 });
    expect(first.find((m) => m.platformId === 'a')).toMatchObject({ seat: 'front', diamonds: 5 });
    expect(first.find((m) => m.platformId === 'b')!.seat).not.toBe('front');
  });

  test('hai bờ luôn lệch ≤ 1 khi người vào / rời, người ở lại giữ bờ nếu không cần cân lại', () => {
    const r = new PlayerRegistry();
    r.frontSeats = 5;
    for (let i = 0; i < ROSTER_MAX; i++) {
      r.participate(u(`p${i}`), 1);
      r.join(`p${i}`, i);
      r.addDiamonds(`p${i}`, i % 7);
      const s = r.roster();
      const left = s.filter((m) => m.seat === 'left').length;
      const right = s.filter((m) => m.seat === 'right').length;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(s.filter((m) => m.seat === 'front').length).toBe(Math.min(5, i + 1));
    }
    const seatOf = new Map(r.roster().map((m) => [m.platformId, m.seat]));
    // Một nửa rời hồ (ngồi không quá lâu)
    r.kickIdle(ROSTER_MAX + 1_000_000, 1_000_000 + ROSTER_MAX / 2);
    const after = r.roster();
    const left = after.filter((m) => m.seat === 'left').length;
    const right = after.filter((m) => m.seat === 'right').length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    const kept = after.filter((m) => m.seat !== 'front' && seatOf.get(m.platformId) === m.seat).length;
    expect(kept).toBeGreaterThan(0);
  });

  test('danh hiệu cần thủ', () => {
    const base = { actionCounts: {} as Record<string, number>, grantedTitles: [] as string[] };
    expect(computeTitle(base)).toBe(TITLES.rookie);
    expect(computeTitle({ ...base, actionCounts: { catch: 20 } })).toBe(TITLES.angler);
    expect(computeTitle({ ...base, actionCounts: { catch: 3, big_catch: 1 } })).toBe(TITLES.big_catch);
    expect(computeTitle({ ...base, grantedTitles: ['Kẻ săn Cá Thần'], actionCounts: { big_catch: 2 } })).toBe(TITLES.king_hunter);
    expect(computeTitle({ ...base, grantedTitles: ['Nhân viên chống đối'] })).toBe(TITLES.king_hunter); // danh hiệu bản cũ
    expect(computeTitle({ ...base, actionCounts: { pull_carp: 6, pull_koi: 4, 'work:thay_moi': 50, catch: 99 } })).toBe(TITLES.troll);
  });
});


describe('Cá to định kỳ', () => {
  /** Cá to mỗi 3 phút, câu thường thưa hẳn để không nhiễu; random điều khiển được qua `rnd.v`. */
  const bigFishEngine = (mut?: Parameters<typeof makeEngine>[0]) => {
    const rnd = { v: 0.5 };
    const h = makeEngine((c) => {
      c.fishing.bigFishEveryMs = 180_000;
      c.fishing.tickMs = 600_000;
      mut?.(c);
    }, () => rnd.v);
    return { ...h, rnd };
  };
  /** Qua mốc hẹn: tick đầu "giữ chỗ" cho quà đến cùng lúc, tick sau cá to mới ra. */
  const reachDue = (h: ReturnType<typeof bigFishEngine>) => {
    h.clock.advance(Math.max(0, h.engine.snapshot().nextBigFishAt - h.clock.now()));
    h.engine.tick();
    h.clock.advance(100);
    h.engine.tick();
  };

  test('đến hạn thì một người đang ngồi được kéo cá to; cân cộng cho họ; hẹn lần sau kèm bóng cá', () => {
    const h = bigFishEngine();
    const { engine, clock, of } = h;
    expect(engine.snapshot()).toMatchObject({ nextBigFishAt: clock.now() + 180_000, bigFishShadowMs: 15_000 });
    expect(of('bigfish.next').at(-1)).toEqual({ at: clock.now() + 180_000, shadowMs: 15_000 });
    engine.ingest(comment('hi', 'a'));
    reachDue(h);
    const run = of('action.started').at(-1)!;
    expect(run).toMatchObject({ actionId: 'big_fish_event', actor: { displayName: 'User a' }, fish: { name: 'Cá to bí ẩn', kg: 19 } });
    expect(engine.snapshot().kgBoard[0]).toMatchObject({ platformId: 'a', kg: 19 });
    expect(of('bigfish.next').at(-1)).toEqual({ at: clock.now() + 180_000, shadowMs: 15_000 });
    expect(engine.snapshot().nextBigFishAt).toBe(clock.now() + 180_000);
  });

  test('chọn ĐỀU giữa MỌI người đang ngồi (RNG tiêm vào) — kể cả người tặng quà và người vừa vào hồ', () => {
    const N = 7;
    const winners: string[] = [];
    for (let k = 0; k < N; k++) {
      const h = bigFishEngine((c) => {
        c.fishing.frontSeats = 1;
      });
      h.engine.ingest(giftEv('rich', 500)); // tặng to → ngồi chiếu giữa
      for (const id of ['a', 'b', 'c', 'd', 'e']) h.engine.ingest(comment('hi', id));
      h.clock.advance(20_000); // cá quà kéo xong
      h.engine.tick();
      expect(h.engine.snapshot().roster[0]).toMatchObject({ platformId: 'rich', seat: 'front' });
      h.clock.advance(Math.max(0, h.engine.snapshot().nextBigFishAt - h.clock.now()) - 1);
      h.engine.ingest(comment('mới tới', 'newbie')); // vừa vào hồ ngay trước giờ cá to
      expect(h.engine.snapshot().roster).toHaveLength(N);
      const order = h.engine.snapshot().roster.map((m) => m.platformId);
      h.rnd.v = (k + 0.5) / N; // lát cắt thứ k của [0, 1) → đúng người thứ k
      reachDue(h);
      const run = h.of('action.started').filter((r) => r.actionId === 'big_fish_event').at(-1)!;
      expect(run.actor!.displayName).toBe(`User ${order[k]}`);
      winners.push(order[k]!);
    }
    // Mỗi người (kể cả người tặng quà ngồi chiếu giữa và người vừa vào) đúng 1 lát cắt bằng nhau.
    expect(new Set(winners).size).toBe(N);
    expect(winners).toContain('rich');
    expect(winners).toContain('newbie');
  });

  test('quà đến cùng lúc với cá to định kỳ: quà kéo trước, cá to định kỳ bị hoãn và báo lại giờ mới', () => {
    for (const giftFirst of [true, false]) {
      const h = bigFishEngine();
      const { engine, clock, of } = h;
      const start = clock.now();
      engine.ingest(comment('hi', 'a'));
      clock.advance(180_000);
      if (giftFirst) engine.ingest(giftEv('b', 1));
      engine.tick(); // đến hạn — giữ chỗ một tick
      if (!giftFirst) engine.ingest(giftEv('b', 1));
      clock.advance(100);
      engine.tick();
      expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp']);
      const postponed = of('bigfish.next').at(-1)!;
      // pull_carp 5 giây bắt đầu lúc 180 000 → hoãn tới khi xong + 1 giây
      expect(postponed).toEqual({ at: start + 180_000 + 5000 + 1000, shadowMs: 15_000 });
      expect(engine.snapshot().nextBigFishAt).toBe(postponed.at);
      reachDue(h);
      expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp', 'big_fish_event']);
    }
  });

  test('quà luôn ưu tiên hơn cá to định kỳ trong hàng đợi', () => {
    const cfg = makeEngine().engine.getConfig();
    const bigFish = cfg.actions.find((a) => a.id === 'big_fish_event')!.priority;
    // Quà vào hàng đợi với priority + 100.
    for (const a of cfg.actions.filter((x) => x.id.startsWith('pull_'))) expect(a.priority + 100).toBeGreaterThan(bigFish);
  });

  test('bigFishEveryMs = 0 thì tắt', () => {
    const { engine, clock, of } = makeEngine();
    engine.ingest(comment('hi', 'a'));
    clock.advance(3_600_000);
    engine.tick();
    engine.tick();
    expect(engine.snapshot().nextBigFishAt).toBe(0);
    expect(of('action.started').filter((r) => r.actionId === 'big_fish_event')).toHaveLength(0);
  });
});
