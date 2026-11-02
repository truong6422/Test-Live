import { describe, expect, test } from 'bun:test';
import { DEFAULT_WORK } from '../src/config/defaults';
import { FOLLOW_HINT_TEXT } from '../src/engine/engine';
import { matchWork } from '../src/engine/matcher';
import { ev, makeCommentEngine, makeEngine } from './helpers';

const comment = (text: string, user = 'u1', follower = true) => ev({ kind: 'comment', text }, user, follower);
const rose = (user: string, follower = false) =>
  ev({ kind: 'gift', gift: { giftId: 5655, name: 'Rose', count: 1, diamonds: 1 } }, user, follower);

describe('Công việc (WorkTask)', () => {
  test('bình luận công việc: phát work, cộng điểm, ghi lịch sử + feed, không chạm Sếp/hàng đợi', () => {
    const { engine, clock, of } = makeEngine();
    // Thực tập sinh chưa follow vẫn làm việc được.
    expect(engine.ingest(comment('Làm việc thôi!', 'w', false))).toBe('work');
    expect(of('work')).toEqual([
      { platformId: 'w', displayName: 'User w', taskId: 'lam_viec', emoji: '⌨️', text: 'Đang chạy deadline...', at: clock.now() }
    ]);
    expect(engine.snapshot().leaderboard[0]).toMatchObject({ platformId: 'w', points: 1 + 2, participations: 1 });
    const h = of('history').at(-1)!;
    expect(h).toMatchObject({ outcome: 'work', actionId: null, summary: 'Làm việc', playerId: 'w' });
    expect(engine.snapshot().feed[0]).toMatchObject({ actionId: null, text: '⌨️ Làm việc', actorName: 'User w' });
    expect(of('action.started')).toHaveLength(0);
    expect(engine.snapshot().queueLength).toBe(0);
    expect(engine.snapshot().boss.calm).toBe(100);
  });

  test('hồi chiêu theo người, theo từng công việc', () => {
    const { engine, clock, of } = makeEngine();
    expect(engine.ingest(comment('lam viec', 'a'))).toBe('work');
    expect(engine.ingest(comment('lam viec', 'a'))).toBe('participated');
    expect(of('history').at(-1)).toMatchObject({ outcome: 'participated', actionId: null });
    expect(engine.ingest(comment('lam viec', 'b'))).toBe('work'); // người khác không bị ảnh hưởng
    expect(engine.ingest(comment('nop bao cao', 'a'))).toBe('work'); // việc khác không bị ảnh hưởng
    clock.advance(19_999);
    expect(engine.ingest(comment('lam viec', 'a'))).toBe('participated');
    clock.advance(1);
    expect(engine.ingest(comment('lam viec', 'a'))).toBe('work');
    expect(of('work').map((w) => `${w.platformId}:${w.taskId}`)).toEqual(['a:lam_viec', 'b:lam_viec', 'a:nop_bao_cao', 'a:lam_viec']);
    // 'a': 5 lượt bình luận (5 điểm) + lam_viec x2 (4) + nop_bao_cao (3)
    expect(engine.players.get('a')?.totalPoints).toBe(5 + 4 + 3);
  });

  test('game dừng thì không làm việc', () => {
    const { engine, of } = makeEngine();
    engine.stop();
    expect(engine.ingest(comment('lam viec'))).toBe('game_stopped');
    expect(of('work')).toHaveLength(0);
  });

  test('công việc tắt thì bỏ qua', () => {
    const { engine } = makeEngine((c) => {
      c.work.find((w) => w.id === 'lam_viec')!.enabled = false;
    });
    expect(engine.ingest(comment('lam viec'))).toBe('participated');
    expect(matchWork('lam viec', DEFAULT_WORK.map((w) => ({ ...w, enabled: false })))).toBeNull();
  });

  test('từ khoá dài hơn thắng; bằng nhau thì hành động thắng', () => {
    const { engine, of } = makeCommentEngine((c) => {
      c.work.push({ id: 'tie', name: 'Hoà', enabled: true, keywords: ['ca phe', 'vat la'], emoji: '?', text: '', points: 1, userCooldownMs: 0 });
    });
    expect(engine.ingest(comment('pha cà phê', 'a'))).toBe('work'); // 'pha ca phe' (10) > 'ca phe' (6)
    expect(of('work')[0]!.taskId).toBe('pha_ca_phe');
    expect(of('action.started')).toHaveLength(0);

    // Không còn hành động "Đổ cà phê": bình luận cà phê chỉ còn là công việc.
    expect(engine.ingest(comment('đổ cà phê', 'd'))).toBe('work');
    expect(of('work')[1]!.taskId).toBe('tie');

    expect(engine.ingest(comment('vặt lá cây phát tài', 'b'))).toBe('accepted'); // 'cay phat tai' (12) > 'vat la' (6) — hành động
    expect(of('action.started').map((r) => r.actionId)).toEqual(['pluck_tree']);

    expect(engine.ingest(comment('vat la', 'c'))).toBe('cooldown'); // hoà 6=6 → hành động (đang hồi chiêu toàn cục)
    expect(of('work')).toHaveLength(2);
  });

  test("'pha cà phê' vẫn là công việc với cấu hình mặc định", () => {
    const { engine, of } = makeEngine();
    expect(engine.ingest(comment('pha cà phê', 'a'))).toBe('work');
    expect(of('work')[0]!.taskId).toBe('pha_ca_phe');
    expect(of('action.started')).toHaveLength(0);
  });
});

describe('followersOnly — trêu Sếp bằng bình luận chỉ dành cho người đã follow', () => {
  test('thực tập sinh bình luận bị lọc, không chạy hoạt ảnh', () => {
    const { engine, of } = makeCommentEngine();
    expect(engine.ingest(comment('1', 'tts', false))).toBe('filtered');
    expect(of('action.started')).toHaveLength(0);
    expect(of('history').at(-1)).toMatchObject({
      outcome: 'filtered',
      actionId: 'throw_paper',
      summary: 'Chỉ nhân viên chính thức (đã follow) mới trêu Sếp bằng bình luận'
    });
    // Vẫn được tính tham gia.
    expect(engine.snapshot().participants).toBe(1);
  });

  test('người đã follow, quà tặng và hành động không giới hạn thì vẫn chạy', () => {
    const { engine, of } = makeCommentEngine();
    expect(engine.ingest(comment('1', 'nv', true))).toBe('accepted');
    expect(engine.ingest(rose('tts'))).toBe('accepted'); // quà luôn qua cổng
    expect(engine.ingest(comment('8', 'tts2', false))).toBe('accepted'); // praise_boss không bật followersOnly
    expect(of('history').filter((h) => h.outcome === 'accepted').map((h) => h.actionId)).toEqual([
      'throw_paper',
      'throw_paper',
      'praise_boss'
    ]);
  });

  test('đã follow trong phiên (sự kiện follow / trạng thái trước đó) thì được trêu', () => {
    const { engine } = makeCommentEngine();
    engine.ingest(ev({ kind: 'follow' }, 'x', false));
    expect(engine.ingest(comment('1', 'x', false))).toBe('accepted');
    const noInfo = { platformId: 'y', username: 'y', displayName: 'Y' };
    engine.ingest(comment('hello', 'y', true));
    expect(engine.ingest(ev({ kind: 'comment', text: '3', user: noInfo }))).toBe('accepted');
  });

  test('tắt followersOnly thì thực tập sinh trêu được', () => {
    const { engine } = makeCommentEngine((c) => {
      c.actions.find((a) => a.id === 'throw_paper')!.trigger.followersOnly = false;
    });
    expect(engine.ingest(comment('1', 'tts', false))).toBe('accepted');
  });

  test('admin bấm test bỏ qua cổng follow', () => {
    const { engine } = makeCommentEngine();
    expect(engine.triggerManual('throw_paper')).toBe('accepted');
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
