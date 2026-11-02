import { describe, expect, test } from 'bun:test';
import { ManualClock } from '../src/engine/clock';
import { GameEngine } from '../src/engine/engine';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import { matchAction } from '../src/engine/matcher';
import { ev, makeCommentEngine, makeEngine, testConfig } from './helpers';

describe('GameEngine — luồng chính', () => {
  test('bình luận hợp lệ kích hoạt hành động, cập nhật Sếp, feed và lịch sử', () => {
    const { engine, of } = makeCommentEngine();
    expect(engine.ingest(ev({ kind: 'comment', text: 'ném giấy' }))).toBe('accepted');
    const started = of('action.started');
    expect(started).toHaveLength(1);
    expect(started[0]!.actionId).toBe('throw_paper');
    expect(started[0]!.actor?.displayName).toBe('User u1');
    expect(engine.snapshot().boss.calm).toBe(96);
    expect(of('feed').at(-1)![0]!.text).toBe('Ném giấy vào Sếp');
    expect(of('history').map((h) => h.outcome)).toContain('accepted');
  });

  test('cùng một sự kiện gửi hai lần chỉ xử lý một lần', () => {
    const { engine, of } = makeCommentEngine();
    const e = ev({ kind: 'comment', text: '1', id: 'same' });
    expect(engine.ingest(e)).toBe('accepted');
    expect(engine.ingest({ ...e })).toBe('deduped');
    expect(of('action.started')).toHaveLength(1);
    expect(engine.players.get('u1')?.totalParticipations).toBe(1);
  });

  test('game dừng thì không xử lý', () => {
    const { engine, of } = makeCommentEngine();
    engine.stop();
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }))).toBe('game_stopped');
    expect(of('action.started')).toHaveLength(0);
  });

  test('bình luận không khớp vẫn được tính tham gia', () => {
    const { engine } = makeCommentEngine();
    expect(engine.ingest(ev({ kind: 'comment', text: 'xin chào' }))).toBe('participated');
    expect(engine.snapshot().participants).toBe(1);
    expect(engine.snapshot().leaderboard[0]!.points).toBe(1);
  });

  test('hành động bị tắt', () => {
    const { engine } = makeCommentEngine((c) => {
      c.actions.find((a) => a.id === 'throw_paper')!.enabled = false;
    });
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }))).toBe('disabled');
  });

  test('cooldown toàn cục và theo người', () => {
    const { engine, clock } = makeCommentEngine();
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }, 'a'))).toBe('accepted');
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }, 'b'))).toBe('cooldown'); // cooldown toàn cục 4s
    clock.advance(4000);
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }, 'a'))).toBe('cooldown'); // theo người 15s
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }, 'b'))).toBe('accepted');
  });

  test('quà tặng bỏ qua cooldown nhưng vẫn qua hàng đợi', () => {
    const { engine } = makeCommentEngine();
    const rose = (id: string) => ev({ id, kind: 'gift', gift: { giftId: 5655, name: 'Rose', count: 1, diamonds: 1 } });
    expect(engine.ingest(rose('g1'))).toBe('accepted');
    expect(engine.ingest(rose('g2'))).toBe('accepted');
    expect(engine.snapshot().queueLength).toBe(1); // cái thứ 2 chờ vì lane boss bận
  });

  test('giới hạn tần suất theo người', () => {
    const clock = new ManualClock();
    const engine = new GameEngine({
      clock,
      config: testConfig((c) => {
        c.limits.userBucketCapacity = 2;
        c.limits.userBucketRefillPerSec = 0;
      })
    });
    engine.start('s');
    const out = [1, 2, 3].map(() => engine.ingest(ev({ kind: 'comment', text: 'hello' })));
    expect(out).toEqual(['participated', 'participated', 'rate_limited']);
  });
});

describe('GameEngine — điều phối hoạt ảnh', () => {
  test('hai hành động cùng lane không chạy chồng; xong cái trước mới chạy cái sau', () => {
    const { engine, clock, of } = makeCommentEngine();
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a')); // throw_paper: boss, 3s
    engine.ingest(ev({ kind: 'comment', text: '5' }, 'b')); // lock_toilet: boss+toilet
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper']);
    clock.advance(2999);
    engine.tick();
    expect(of('action.started')).toHaveLength(1);
    clock.advance(1);
    engine.tick();
    expect(of('action.ended').map((r) => r.actionId)).toEqual(['throw_paper']);
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper', 'lock_toilet']);
  });

  test('hành động chạy lần lượt từng cái một, kể cả khác lane', () => {
    const { engine, clock, of } = makeCommentEngine();
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a')); // throw_paper: boss, 3s
    engine.ingest(ev({ kind: 'comment', text: '4' }, 'b')); // flat_tire: car+… — phải chờ
    engine.ingest(ev({ kind: 'comment', text: '2' }, 'c')); // pluck_tree — chờ tiếp
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper']);
    expect(engine.snapshot().queueLength).toBe(2);
    clock.advance(2999);
    engine.tick();
    expect(of('action.started')).toHaveLength(1);
    clock.advance(1);
    engine.tick();
    expect(of('action.ended').map((r) => r.actionId)).toEqual(['throw_paper']);
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper', 'flat_tire']);
    expect(engine.snapshot().runningActions).toHaveLength(1);
    clock.advance(9000);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper', 'flat_tire', 'pluck_tree']);
    expect(engine.snapshot().runningActions).toHaveLength(1);
  });

  test('maxConcurrent cũ lưu trong DB (vd. 3) bị ép về 1', () => {
    const { engine, of } = makeCommentEngine((c) => {
      c.limits.maxConcurrent = 3;
    });
    expect(engine.getConfig().limits.maxConcurrent).toBe(1);
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a')); // boss
    engine.ingest(ev({ kind: 'comment', text: '7' }, 'b')); // boss
    const cfg = engine.getConfig();
    cfg.limits.maxConcurrent = 5;
    engine.updateConfig(cfg);
    expect(engine.getConfig().limits.maxConcurrent).toBe(1);
    engine.ingest(ev({ kind: 'comment', text: '4' }, 'c'));
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper']);
    expect(engine.snapshot().runningActions).toHaveLength(1);
  });

  test('hoạt ảnh đang chạy không bao giờ có lane trùng nhau', () => {
    const { engine, clock } = makeCommentEngine();
    const texts = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (let i = 0; i < 200; i++) {
      const g = i % 3 === 0;
      engine.ingest(
        g
          ? ev({ kind: 'gift', gift: { giftId: 5655, name: 'Rose', count: 1 + (i % 15), diamonds: 1 } }, `u${i}`)
          : ev({ kind: 'comment', text: texts[i % texts.length]! }, `u${i}`)
      );
      clock.advance(137);
      engine.tick();
      const lanes = engine.snapshot().runningActions.flatMap((r) => r.lanes);
      expect(new Set(lanes).size).toBe(lanes.length);
      expect(engine.snapshot().runningActions.length).toBeLessThanOrEqual(1);
      expect(engine.snapshot().queueLength).toBeLessThanOrEqual(20);
    }
  });

  test('hàng đợi đầy: quà đẩy bình luận ưu tiên thấp ra', () => {
    const { engine, of } = makeCommentEngine((c) => {
      c.limits.maxQueue = 1;
      c.actions.forEach((a) => {
        a.cooldownMs = 0;
        a.userCooldownMs = 0;
      });
    });
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a')); // chạy ngay
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'b')); // vào hàng đợi
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }, 'c'))).toBe('dropped');
    expect(engine.ingest(ev({ kind: 'gift', gift: { giftId: 5655, name: 'Rose', count: 1, diamonds: 1 } }, 'd'))).toBe('accepted');
    expect(of('history').filter((h) => h.outcome === 'dropped').map((h) => h.playerId)).toEqual(['c', 'b']);
  });

  test('mục chờ quá lâu bị bỏ', () => {
    const { engine, clock, of } = makeCommentEngine((c) => {
      c.limits.queueMaxWaitMs = 1000;
      c.actions.find((a) => a.id === 'throw_paper')!.durationMs = 5000;
      c.actions.forEach((a) => (a.cooldownMs = 0));
    });
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a'));
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'b'));
    clock.advance(1500);
    engine.tick();
    expect(of('history').some((h) => h.outcome === 'expired' && h.playerId === 'b')).toBe(true);
  });

  test('test thủ công chạy kể cả khi hành động tắt, không cộng điểm', () => {
    const { engine, of } = makeCommentEngine((c) => {
      c.actions.find((a) => a.id === 'flat_tire')!.enabled = false;
    });
    expect(engine.triggerManual('flat_tire')).toBe('accepted');
    expect(of('action.started')[0]!.source).toBe('manual');
    expect(engine.snapshot().participants).toBe(0);
  });
});

describe('GameEngine — sự kiện tập thể', () => {
  test('đủ mục tiêu thì Đình công chạy, người góp sức được danh hiệu, vòng mới mở lại', () => {
    const { engine, clock, of } = makeCommentEngine((c) => {
      c.collective.goal = 3;
      c.collective.restartDelayMs = 1000;
    });
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'a'));
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'b'));
    engine.ingest(ev({ kind: 'like', likeCount: 5 }, 'c')); // thả tim không tính vào tập thể
    expect(engine.snapshot().collective?.progress).toBe(2);
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'c'));
    expect(engine.snapshot().collective?.status).toBe('completed');
    expect(of('action.started').map((r) => r.actionId)).toEqual(['strike']);
    expect(engine.snapshot().boss.mood).not.toBe('normal');
    expect(engine.snapshot().leaderboard.find((e) => e.platformId === 'a')?.title).toBe('Nhân viên chống đối');
    clock.advance(1000);
    engine.tick();
    expect(engine.snapshot().collective?.status).toBe('active');
    expect(engine.snapshot().collective?.progress).toBe(0);
  });

  test('Đình công chờ các hoạt ảnh khác xong và không bị chen', () => {
    const { engine, clock, of } = makeCommentEngine((c) => {
      c.collective.goal = 2;
    });
    engine.ingest(ev({ kind: 'comment', text: '3' }, 'a')); // doodle_kpi (7s), cũng là lượt góp 1
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'b')); // góp 2 -> strike vào hàng đợi
    engine.ingest(ev({ kind: 'comment', text: '4' }, 'c')); // flat_tire — phải chờ strike
    expect(of('action.started').map((r) => r.actionId)).toEqual(['doodle_kpi']);
    clock.advance(engine.snapshot().runningActions[0]!.durationMs - 1);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['doodle_kpi']); // strike chưa được chen ngang
    clock.advance(1);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['doodle_kpi', 'strike']);
    expect(engine.snapshot().runningActions.map((r) => r.actionId)).toEqual(['strike']);
    clock.advance(9000);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['doodle_kpi', 'strike', 'flat_tire']);
  });

  test('Đình công đợi cả hành động khác lane (chạy nối tiếp tuyệt đối)', () => {
    const { engine, clock, of } = makeCommentEngine((c) => {
      c.collective.goal = 2;
      // Ép strike chỉ dùng một lane riêng để chắc chắn nó chờ vì giới hạn 1, không phải vì trùng lane.
      c.actions.find((a) => a.id === 'strike')!.lanes = ['staff'];
    });
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a')); // throw_paper (boss), góp 1
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'b')); // góp 2 -> strike
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper']);
    clock.advance(3000);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['throw_paper', 'strike']);
  });
});

describe('GameEngine — phiên', () => {
  test('reset phiên xoá thống kê phiên nhưng giữ tổng', () => {
    const { engine } = makeCommentEngine();
    engine.ingest(ev({ kind: 'comment', text: '1' }));
    engine.resetSession('s2');
    const snap = engine.snapshot();
    expect(snap.participants).toBe(0);
    expect(snap.runningActions).toHaveLength(0);
    expect(snap.boss.calm).toBe(100);
    expect(snap.sessionId).toBe('s2');
    expect(engine.players.leaderboard('total')[0]!.platformId).toBe('u1');
  });

  test('admin chỉnh độ bình tĩnh', () => {
    const { engine } = makeCommentEngine();
    engine.setBossCalm(20);
    expect(engine.snapshot().boss).toMatchObject({ calm: 20, mood: 'panic' });
  });
});

describe('GameEngine — trêu Sếp chỉ bằng quà, xếp hạng theo kim cương', () => {
  const gift = (user: string, diamonds: number, count = 1, giftId = 9999) =>
    ev({ kind: 'gift', gift: { giftId, name: `Quà ${diamonds}`, count, diamonds } }, user, false);

  test('cấu hình mặc định: bình luận số / từ khoá không trêu Sếp, công việc vẫn chạy', () => {
    const { engine, of } = makeEngine();
    for (const text of ['1', '4', 'ném giấy', 'vặt lá cây phát tài', 'cúp điện']) {
      expect(engine.ingest(ev({ kind: 'comment', text }, `c${text}`))).toBe('participated');
    }
    expect(engine.ingest(ev({ kind: 'like', likeCount: 20 }, 'l'))).toBe('participated');
    expect(engine.ingest(ev({ kind: 'share' }, 's'))).toBe('participated');
    expect(engine.ingest(ev({ kind: 'comment', text: 'làm việc' }, 'w'))).toBe('work');
    expect(of('action.started')).toHaveLength(0);
    expect(engine.snapshot().boss.calm).toBe(100);
  });

  test('quà kích hoạt hành động theo bậc giá trị (kể cả thực tập sinh)', () => {
    const { engine, clock, of } = makeEngine();
    expect(engine.ingest(gift('a', 500))).toBe('accepted'); // Money Gun → blackout
    expect(engine.ingest(gift('b', 1, 1, 7934))).toBe('accepted'); // Heart Me → praise_boss
    for (let i = 0; i < 30; i++) {
      clock.advance(1000);
      engine.tick();
    }
    expect(of('action.started').map((r) => r.actionId)).toEqual(['blackout', 'praise_boss']);
    expect(of('history').find((h) => h.playerId === 'a')?.summary).toBe('Tặng 1x Quà 500 (id 9999, 500 kim cương) → Ngắt cầu dao');
  });

  test('leaderboard (WS + snapshot) mang diamonds và xếp theo kim cương', () => {
    const { engine, of } = makeEngine();
    engine.ingest(ev({ kind: 'comment', text: 'xin chào' }, 'talk'));
    engine.ingest(ev({ kind: 'comment', text: 'làm việc' }, 'talk'));
    engine.ingest(gift('rich', 99, 3));
    engine.ingest(gift('cheap', 1, 5));
    engine.tick(); // gom và phát leaderboard
    const snap = engine.snapshot().leaderboard;
    expect(snap.map((e) => [e.platformId, e.diamonds])).toEqual([
      ['rich', 297],
      ['cheap', 5],
      ['talk', 0]
    ]);
    const ws = of('leaderboard').at(-1)!;
    expect(ws.entries.map((e) => [e.platformId, e.diamonds])).toEqual([
      ['rich', 297],
      ['cheap', 5],
      ['talk', 0]
    ]);
    expect(ws.participants).toBe(3);
    expect(engine.players.leaderboard('total')[0]).toMatchObject({ platformId: 'rich', diamonds: 297 });
  });

  test('chế độ demo sinh quà đủ mọi bậc trêu Sếp', () => {
    const d = new DemoConnector(1000, Math.random);
    const { actions, gifts } = testConfig();
    const seen = new Set<string>();
    for (let i = 0; i < 20_000 && seen.size < 9; i++) {
      const e = d.next(i);
      if (e.kind !== 'gift') continue;
      const m = matchAction(e, actions, gifts);
      if (m) seen.add(m.action.id);
    }
    expect([...seen].sort()).toEqual(
      ['blackout', 'complaint_call', 'crash_pc', 'doodle_kpi', 'flat_tire', 'lock_toilet', 'pluck_tree', 'praise_boss', 'throw_paper'].sort()
    );
  });
});
