import { describe, expect, test } from 'bun:test';
import { ManualClock } from '../src/engine/clock';
import { GameEngine } from '../src/engine/engine';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import { matchAction } from '../src/engine/matcher';
import { ev, giftEv, makeCommentEngine, makeEngine, testConfig } from './helpers';

describe('GameEngine — luồng chính', () => {
  test('bình luận hợp lệ kích hoạt hành động, chốt cân cá to, cập nhật Cá Thần, feed và lịch sử', () => {
    const { engine, of } = makeCommentEngine();
    expect(engine.ingest(ev({ kind: 'comment', text: 'kéo cá chép' }))).toBe('accepted');
    const started = of('action.started');
    expect(started).toHaveLength(1);
    expect(started[0]!.actionId).toBe('pull_carp');
    expect(started[0]!.actor?.displayName).toBe('User u1');
    expect(started[0]!.fish).toEqual({ emoji: '🐟', name: 'Cá chép to', kg: 4.5 }); // 3 + 0.5 × (6 − 3)
    expect(engine.snapshot().king.calm).toBe(97);
    expect(of('feed').at(-1)![0]!.text).toBe('Kéo cá chép to: 🐟 Cá chép to 4,5kg');
    expect(of('history').map((h) => h.outcome)).toContain('accepted');
    expect(engine.snapshot().kgBoard[0]).toMatchObject({ platformId: 'u1', kg: 4.5 });
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

  test('bình luận không khớp vẫn được tính tham gia và vào hồ', () => {
    const { engine } = makeCommentEngine();
    expect(engine.ingest(ev({ kind: 'comment', text: 'xin chào' }))).toBe('participated');
    expect(engine.snapshot().participants).toBe(1);
    expect(engine.snapshot().leaderboard[0]!.points).toBe(1);
    expect(engine.snapshot().roster.map((m) => m.platformId)).toEqual(['u1']);
  });

  test('hành động bị tắt', () => {
    const { engine } = makeCommentEngine((c) => {
      c.actions.find((a) => a.id === 'pull_carp')!.enabled = false;
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
    expect(engine.snapshot().queueLength).toBe(1); // cái thứ 2 chờ vì đang chạy cái đầu
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
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a')); // pull_carp: 5s
    engine.ingest(ev({ kind: 'comment', text: '5' }, 'b')); // pull_arowana
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp']);
    clock.advance(4999);
    engine.tick();
    expect(of('action.started')).toHaveLength(1);
    clock.advance(1);
    engine.tick();
    expect(of('action.ended').map((r) => r.actionId)).toEqual(['pull_carp']);
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp', 'pull_arowana']);
  });

  test('hành động chạy lần lượt từng cái một, kể cả khác lane', () => {
    const { engine, clock, of } = makeCommentEngine((c) => {
      c.actions.find((a) => a.id === 'pull_grass_carp')!.lanes = ['sky'];
    });
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a')); // pull_carp: 5s
    engine.ingest(ev({ kind: 'comment', text: '4' }, 'b')); // pull_stingray (10s) — phải chờ
    engine.ingest(ev({ kind: 'comment', text: '2' }, 'c')); // pull_grass_carp (lane riêng) — vẫn chờ
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp']);
    expect(engine.snapshot().queueLength).toBe(2);
    clock.advance(5000);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp', 'pull_stingray']);
    expect(engine.snapshot().runningActions).toHaveLength(1);
    clock.advance(10000);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp', 'pull_stingray', 'pull_grass_carp']);
    expect(engine.snapshot().runningActions).toHaveLength(1);
  });

  test('maxConcurrent cũ lưu trong DB (vd. 3) bị ép về 1', () => {
    const { engine, of } = makeCommentEngine((c) => {
      c.limits.maxConcurrent = 3;
    });
    expect(engine.getConfig().limits.maxConcurrent).toBe(1);
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a'));
    engine.ingest(ev({ kind: 'comment', text: '7' }, 'b'));
    const cfg = engine.getConfig();
    cfg.limits.maxConcurrent = 5;
    engine.updateConfig(cfg);
    expect(engine.getConfig().limits.maxConcurrent).toBe(1);
    engine.ingest(ev({ kind: 'comment', text: '4' }, 'c'));
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp']);
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
      c.actions.forEach((a) => (a.cooldownMs = 0));
    });
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'a'));
    engine.ingest(ev({ kind: 'comment', text: '1' }, 'b'));
    clock.advance(1500);
    engine.tick();
    expect(of('history').some((h) => h.outcome === 'expired' && h.playerId === 'b')).toBe(true);
  });

  test('test thủ công chạy kể cả khi hành động tắt, không cộng điểm / cân', () => {
    const { engine, of } = makeCommentEngine((c) => {
      c.actions.find((a) => a.id === 'pull_stingray')!.enabled = false;
    });
    expect(engine.triggerManual('pull_stingray')).toBe('accepted');
    expect(of('action.started')[0]!.source).toBe('manual');
    expect(of('action.started')[0]!.fish?.name).toBe('Cá đuối khổng lồ');
    expect(engine.snapshot().participants).toBe(0);
    expect(engine.snapshot().kgBoard).toEqual([]);
  });
});

describe('GameEngine — sự kiện tập thể', () => {
  test('đủ mục tiêu thì Cả hồ kéo Cá Thần chạy, cân chia đều, người góp sức được danh hiệu, vòng mới mở lại', () => {
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
    const started = of('action.started');
    expect(started.map((r) => r.actionId)).toEqual(['grand_haul']);
    expect(started[0]!.fish).toEqual({ emoji: '👑', name: 'Cá Thần', kg: 300 }); // 200 + 0.5 × 200
    // 300 kg chia 3 người = 100 kg mỗi người
    // (c có thêm điểm thả tim nên đứng đầu khi bằng cân)
    expect(engine.snapshot().kgBoard.map((e) => [e.platformId, e.kg])).toEqual([
      ['c', 100],
      ['a', 100],
      ['b', 100]
    ]);
    expect(engine.snapshot().king.mood).not.toBe('calm');
    expect(engine.snapshot().leaderboard.find((e) => e.platformId === 'a')?.title).toBe('Kẻ săn Cá Thần');
    clock.advance(1000);
    engine.tick();
    expect(engine.snapshot().collective?.status).toBe('active');
    expect(engine.snapshot().collective?.progress).toBe(0);
  });

  test('Cả hồ kéo Cá Thần chờ các hoạt ảnh khác xong và không bị chen', () => {
    const { engine, clock, of } = makeCommentEngine((c) => {
      c.collective.goal = 2;
    });
    engine.ingest(ev({ kind: 'comment', text: '3' }, 'a')); // pull_catfish (7s), cũng là lượt góp 1
    engine.ingest(ev({ kind: 'comment', text: 'hi' }, 'b')); // góp 2 -> grand_haul vào hàng đợi
    engine.ingest(ev({ kind: 'comment', text: '4' }, 'c')); // pull_stingray — phải chờ grand_haul
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_catfish']);
    clock.advance(engine.snapshot().runningActions[0]!.durationMs - 1);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_catfish']);
    clock.advance(1);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_catfish', 'grand_haul']);
    clock.advance(12000);
    engine.tick();
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_catfish', 'grand_haul', 'pull_stingray']);
  });
});

describe('GameEngine — phiên', () => {
  test('reset phiên xoá thống kê phiên + người ngồi câu nhưng giữ tổng', () => {
    const { engine } = makeCommentEngine();
    engine.ingest(ev({ kind: 'comment', text: '1' }));
    engine.resetSession('s2');
    const snap = engine.snapshot();
    expect(snap.participants).toBe(0);
    expect(snap.roster).toEqual([]);
    expect(snap.runningActions).toHaveLength(0);
    expect(snap.king.calm).toBe(100);
    expect(snap.sessionId).toBe('s2');
    expect(engine.players.leaderboard('total')[0]!.platformId).toBe('u1');
    expect(engine.players.kgBoard('total')[0]).toMatchObject({ platformId: 'u1', kg: 4.5 });
  });

  test('admin chỉnh độ bình thản Cá Thần', () => {
    const { engine, of } = makeCommentEngine();
    engine.setKingCalm(20);
    expect(engine.snapshot().king).toMatchObject({ calm: 20, mood: 'thrashing' });
    expect(of('king').at(-1)).toMatchObject({ calm: 20, mood: 'thrashing' });
  });
});

describe('GameEngine — quà → kéo cá to, xếp hạng theo kim cương và kg', () => {
  test('cấu hình mặc định: bình luận / like / share không kéo cá to, việc vui vẫn chạy', () => {
    const { engine, of } = makeEngine();
    for (const text of ['1', '4', 'kéo cá chép', 'cá lăng']) {
      expect(engine.ingest(ev({ kind: 'comment', text }, `c${text}`))).toBe('participated');
    }
    expect(engine.ingest(ev({ kind: 'like', likeCount: 20 }, 'l'))).toBe('participated');
    expect(engine.ingest(ev({ kind: 'share' }, 's'))).toBe('participated');
    expect(engine.ingest(ev({ kind: 'comment', text: 'thay mồi' }, 'w'))).toBe('work');
    expect(of('action.started')).toHaveLength(0);
  });

  test('quà kéo cá to theo bậc giá trị; cân cộng cho người tặng (kể cả tập sự)', () => {
    const { engine, clock, of } = makeEngine();
    expect(engine.ingest(giftEv('a', 500))).toBe('accepted'); // Money Gun → pull_legend
    expect(engine.ingest(giftEv('b', 1, 1, 7934))).toBe('accepted'); // Heart Me → pull_koi
    for (let i = 0; i < 30; i++) {
      clock.advance(1000);
      engine.tick();
    }
    const started = of('action.started');
    expect(started.map((r) => r.actionId)).toEqual(['pull_legend', 'pull_koi']);
    expect(started[0]!.fish).toEqual({ emoji: '👑', name: 'Cá Thần huyền thoại', kg: 225 });
    expect(of('history').find((h) => h.playerId === 'a' && h.outcome === 'accepted')?.summary).toBe(
      'Tặng 1x Quà 500 (id 9999, 500 kim cương) → Kéo Cá Thần huyền thoại (Cá Thần huyền thoại 225kg)'
    );
    const a = engine.snapshot().kgBoard.find((e) => e.platformId === 'a')!;
    expect(a.kg).toBeGreaterThanOrEqual(225); // + cá câu tự động trong 30 giây
    expect(engine.players.get('a')?.actionCounts.big_catch).toBeGreaterThanOrEqual(1);
  });

  test('leaderboard (WS + snapshot) mang diamonds + kgBoard, xếp theo kim cương', () => {
    const { engine, of } = makeEngine();
    engine.ingest(ev({ kind: 'comment', text: 'xin chào' }, 'talk'));
    engine.ingest(ev({ kind: 'comment', text: 'thay mồi' }, 'talk'));
    engine.ingest(giftEv('rich', 99, 3));
    engine.ingest(giftEv('cheap', 1, 5));
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
    // 297 → pull_arowana 55 kg; 5 → pull_grass_carp 9 kg
    expect(ws.kgBoard.map((e) => [e.platformId, e.kg])).toEqual([
      ['rich', 55],
      ['cheap', 9]
    ]);
    expect(ws.participants).toBe(3);
    expect(engine.players.leaderboard('total')[0]).toMatchObject({ platformId: 'rich', diamonds: 297, kg: 55 });
  });

  test('chế độ demo sinh quà đủ mọi bậc kéo cá to', () => {
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
      ['pull_carp', 'pull_grass_carp', 'pull_catfish', 'pull_snakehead', 'pull_giant_catfish', 'pull_arowana', 'pull_stingray', 'pull_legend', 'pull_koi'].sort()
    );
  });
});
