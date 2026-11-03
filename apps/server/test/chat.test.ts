import { describe, expect, test } from 'bun:test';
import { ev, makeCommentEngine, makeEngine } from './helpers';

describe('bong bóng chat', () => {
  test('bình luận thường phát "chat" kèm tên và nội dung', () => {
    const { engine, of } = makeEngine();
    expect(engine.ingest(ev({ kind: 'comment', text: '  Hello cả nhà  ' }, 'c1'))).toBe('participated');
    const chats = of('chat');
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ platformId: 'c1', displayName: 'User c1', text: 'Hello cả nhà' });
  });

  test('bình luận khớp hành động không phát "chat" (đã có toast riêng)', () => {
    const { engine, of } = makeCommentEngine();
    expect(engine.ingest(ev({ kind: 'comment', text: '1' }, 'c2'))).toBe('accepted');
    expect(of('chat')).toHaveLength(0);
  });

  test('like / share không phát "chat"', () => {
    const { engine, of } = makeEngine();
    engine.ingest(ev({ kind: 'like' }, 'c3'));
    engine.ingest(ev({ kind: 'share' }, 'c3'));
    expect(of('chat')).toHaveLength(0);
  });
});
