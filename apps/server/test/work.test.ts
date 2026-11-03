import { describe, expect, test } from 'bun:test';
import { DEFAULT_WORK } from '../src/config/defaults';
import { FOLLOW_HINT_TEXT } from '../src/engine/engine';
import { matchWork } from '../src/engine/matcher';
import { ev, makeCommentEngine, makeEngine } from './helpers';

const comment = (text: string, user = 'u1', follower = true) => ev({ kind: 'comment', text }, user, follower);
const rose = (user: string, follower = false) =>
  ev({ kind: 'gift', gift: { giftId: 5655, name: 'Rose', count: 1, diamonds: 1 } }, user, follower);

describe('Việc vui (WorkTask)', () => {
  test('mặc định không còn việc "Câu cá" / loot (câu là tự động)', () => {
    expect(DEFAULT_WORK.map((w) => w.id)).toEqual(['thay_moi', 'uong_tra', 'khoe_ca', 'hat_ho', 'ngu_gat']);
    expect(DEFAULT_WORK.every((w) => w.loot === undefined)).toBe(true);
  });

  test('bình luận việc vui: phát work, cộng điểm, ghi lịch sử + feed, không chạm Cá Thần/hàng đợi', () => {
    const { engine, clock, of } = makeEngine();
    // Cần thủ tập sự chưa follow vẫn làm được.
    expect(engine.ingest(comment('Thay mồi thôi!', 'w', false))).toBe('work');
    expect(of('work')).toEqual([
      { platformId: 'w', displayName: 'User w', taskId: 'thay_moi', emoji: '🪱', text: 'Mồi giun xịn đây!', at: clock.now(), points: 1 }
    ]);
    expect(engine.snapshot().leaderboard[0]).toMatchObject({ platformId: 'w', points: 1 + 1, participations: 1 });
    const h = of('history').at(-1)!;
    expect(h).toMatchObject({ outcome: 'work', actionId: null, summary: 'Thay mồi', playerId: 'w' });
    expect(engine.snapshot().feed[0]).toMatchObject({ actionId: null, text: '🪱 Thay mồi', actorName: 'User w' });
    expect(of('action.started')).toHaveLength(0);
    expect(engine.snapshot().queueLength).toBe(0);
    expect(engine.snapshot().king.calm).toBe(100);
  });

  test('hồi chiêu theo người, theo từng việc', () => {
    const { engine, clock, of } = makeEngine();
    expect(engine.ingest(comment('thay moi', 'a'))).toBe('work');
    expect(engine.ingest(comment('thay moi', 'a'))).toBe('participated');
    expect(of('history').at(-1)).toMatchObject({ outcome: 'participated', actionId: null });
    expect(engine.ingest(comment('thay moi', 'b'))).toBe('work'); // người khác không bị ảnh hưởng
    expect(engine.ingest(comment('khoe ca', 'a'))).toBe('work'); // việc khác không bị ảnh hưởng
    clock.advance(19_999);
    expect(engine.ingest(comment('thay moi', 'a'))).toBe('participated');
    clock.advance(1);
    expect(engine.ingest(comment('thay moi', 'a'))).toBe('work');
    expect(of('work').map((w) => `${w.platformId}:${w.taskId}`)).toEqual(['a:thay_moi', 'b:thay_moi', 'a:khoe_ca', 'a:thay_moi']);
    // 'a': 5 lượt bình luận (5 điểm) + thay_moi x2 (2) + khoe_ca (2) — chưa qua chu kỳ câu nào
    expect(engine.players.get('a')?.totalPoints).toBe(5 + 2 + 2);
  });

  test('việc admin thêm có loot: bốc món, điền {name}/{kg}, cộng cân + điểm thưởng', () => {
    const { engine, of } = makeEngine((c) => {
      c.work.push({
        id: 'vot_ca',
        name: 'Vớt cá',
        enabled: true,
        keywords: ['vot ca'],
        emoji: '🥅',
        text: 'Vớt được {name} {kg}kg',
        points: 2,
        userCooldownMs: 0,
        loot: [
          { emoji: '🥾', name: 'Ủng rách', weight: 1, minKg: 0, maxKg: 0, points: 0 },
          { emoji: '🐠', name: 'Cá chép', weight: 1, minKg: 1, maxKg: 3, points: 4 }
        ]
      });
    });
    expect(engine.ingest(comment('vớt cá'))).toBe('work');
    expect(of('work')[0]).toMatchObject({ taskId: 'vot_ca', emoji: '🐠', text: 'Vớt được Cá chép 2kg', points: 6, catch: { name: 'Cá chép', kg: 2 } });
    expect(engine.snapshot().kgBoard[0]).toMatchObject({ platformId: 'u1', kg: 2 });
  });

  test('game dừng thì không làm việc', () => {
    const { engine, of } = makeEngine();
    engine.stop();
    expect(engine.ingest(comment('thay moi'))).toBe('game_stopped');
    expect(of('work')).toHaveLength(0);
  });

  test('việc tắt thì bỏ qua', () => {
    const { engine } = makeEngine((c) => {
      c.work.find((w) => w.id === 'thay_moi')!.enabled = false;
    });
    expect(engine.ingest(comment('thay moi'))).toBe('participated');
    expect(matchWork('thay moi', DEFAULT_WORK.map((w) => ({ ...w, enabled: false })))).toBeNull();
  });

  test('từ khoá dài hơn thắng; bằng nhau thì hành động thắng', () => {
    const { engine, of } = makeCommentEngine((c) => {
      c.work.push({ id: 'tie', name: 'Hoà', enabled: true, keywords: ['ca koi', 'ca chep'], emoji: '?', text: '', points: 1, userCooldownMs: 0 });
    });
    expect(engine.ingest(comment('uống trà đá', 'a'))).toBe('work');
    expect(of('work')[0]!.taskId).toBe('uong_tra');

    expect(engine.ingest(comment('kéo cá chép', 'b'))).toBe('accepted'); // 'keo ca chep' (11) > 'ca chep' (7) — hành động
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pull_carp']);

    expect(engine.ingest(comment('ca koi', 'c'))).toBe('accepted'); // hoà 6=6 → hành động
    expect(of('work')).toHaveLength(1);
  });
});

describe('followersOnly — kích hoạt bằng bình luận chỉ dành cho người đã follow', () => {
  test('cần thủ tập sự bình luận bị lọc, không chạy hoạt ảnh', () => {
    const { engine, of } = makeCommentEngine();
    expect(engine.ingest(comment('1', 'tts', false))).toBe('filtered');
    expect(of('action.started')).toHaveLength(0);
    expect(of('history').at(-1)).toMatchObject({
      outcome: 'filtered',
      actionId: 'pull_carp',
      summary: 'Chỉ cần thủ chính thức (đã follow) mới kích hoạt bằng bình luận'
    });
    // Vẫn được tính tham gia và vào hồ.
    expect(engine.snapshot().participants).toBe(1);
    expect(engine.snapshot().roster[0]).toMatchObject({ platformId: 'tts', follower: false });
  });

  test('người đã follow, quà tặng và hành động không giới hạn thì vẫn chạy', () => {
    const { engine, of } = makeCommentEngine();
    expect(engine.ingest(comment('1', 'nv', true))).toBe('accepted');
    expect(engine.ingest(rose('tts'))).toBe('accepted'); // quà luôn qua cổng
    expect(engine.ingest(comment('8', 'tts2', false))).toBe('accepted'); // pull_koi không bật followersOnly
    expect(of('history').filter((h) => h.outcome === 'accepted').map((h) => h.actionId)).toEqual(['pull_carp', 'pull_carp', 'pull_koi']);
  });

  test('đã follow trong phiên (sự kiện follow / trạng thái trước đó) thì được kích hoạt', () => {
    const { engine } = makeCommentEngine();
    engine.ingest(ev({ kind: 'follow' }, 'x', false));
    expect(engine.ingest(comment('1', 'x', false))).toBe('accepted');
    const noInfo = { platformId: 'y', username: 'y', displayName: 'Y' };
    engine.ingest(comment('hello', 'y', true));
    expect(engine.ingest(ev({ kind: 'comment', text: '3', user: noInfo }))).toBe('accepted');
  });

  test('tắt followersOnly thì cần thủ tập sự kích hoạt được', () => {
    const { engine } = makeCommentEngine((c) => {
      c.actions.find((a) => a.id === 'pull_carp')!.trigger.followersOnly = false;
    });
    expect(engine.ingest(comment('1', 'tts', false))).toBe('accepted');
  });

  test('admin bấm test bỏ qua cổng follow', () => {
    const { engine } = makeCommentEngine();
    expect(engine.triggerManual('pull_carp')).toBe('accepted');
  });

  test('nhắc follow tối đa 1 lần / người / 60 giây', () => {
    const { engine, clock } = makeCommentEngine((c) => c.actions.forEach((a) => (a.userCooldownMs = a.cooldownMs = 0)));
    const hints = () => engine.snapshot().feed.filter((f) => f.text === FOLLOW_HINT_TEXT);
    engine.ingest(comment('1', 'tts', false));
    engine.ingest(comment('2', 'tts', false));
    expect(hints()).toHaveLength(1);
    expect(hints()[0]).toMatchObject({ actionId: null, actorName: 'User tts' });
    engine.ingest(comment('1', 'other', false));
    expect(hints()).toHaveLength(2);
    clock.advance(59_999);
    engine.ingest(comment('1', 'tts', false));
    expect(hints()).toHaveLength(2);
    clock.advance(1);
    engine.ingest(comment('1', 'tts', false));
    expect(hints()).toHaveLength(3);
  });
});
