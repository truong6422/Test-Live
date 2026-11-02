import { describe, expect, test } from 'bun:test';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import { TikTokNormalizer } from '../src/normalizer/tiktok-normalizer';
import { PlayerRegistry } from '../src/players/players';
import { ev, makeEngine } from './helpers';

const u = (id: string, follower?: boolean) => ({ platformId: id, username: id, displayName: `Tên ${id}`, follower });

describe('Follow → nhân viên chính thức', () => {
  test('normalizer đọc trạng thái follow từ userIdentity và followInfo', () => {
    const n = new TikTokNormalizer();
    const base = { id: '1', displayId: 'a', nickname: 'A' };
    expect(n.chat({ user: base, content: 'hi', userIdentity: { isFollowerOfAnchor: true } }, 0)?.user.follower).toBe(true);
    expect(n.chat({ user: base, content: 'hi', userIdentity: { isFollowerOfAnchor: false } }, 0)?.user.follower).toBe(false);
    expect(n.chat({ user: { ...base, followInfo: { followStatus: '1' } }, content: 'hi' }, 0)?.user.follower).toBe(true);
    expect(n.chat({ user: { ...base, followInfo: { followStatus: '0' } }, content: 'hi' }, 0)?.user.follower).toBe(false);
    // TikTok không gửi gì → chưa rõ (không tự coi là đã follow)
    expect(n.chat({ user: base, content: 'hi' }, 0)?.user.follower).toBeUndefined();
  });

  test('registry: follow giữ nguyên trong phiên, roster xếp người tương tác gần nhất trước', () => {
    const r = new PlayerRegistry();
    r.participate(u('a', true), 1);
    r.participate(u('b'), 1);
    r.participate(u('a', false), 1); // lần sau TikTok báo false/không rõ → vẫn chính thức
    expect(r.roster().map((m) => [m.platformId, m.follower])).toEqual([
      ['a', true],
      ['b', false]
    ]);
    expect(r.markFollower('b')).toBe(true);
    expect(r.markFollower('b')).toBe(false);
    expect(r.roster().find((m) => m.platformId === 'b')?.follower).toBe(true);
    r.resetSession();
    expect(r.roster()).toEqual([]);
  });

  test('roster tối đa 100 người', () => {
    const r = new PlayerRegistry();
    for (let i = 0; i < 130; i++) r.participate(u(`p${i}`), 1);
    const roster = r.roster();
    expect(roster).toHaveLength(100);
    expect(roster[0]!.platformId).toBe('p129');
  });

  test('engine: sự kiện follow chuyển TTS thành chính thức và phát roster', () => {
    const { engine, clock, of } = makeEngine();
    engine.ingest(ev({ kind: 'comment', text: 'hello', user: u('x') }));
    expect(engine.snapshot().roster[0]).toMatchObject({ platformId: 'x', follower: false });
    engine.ingest(ev({ kind: 'follow', user: u('x') }));
    expect(engine.snapshot().roster[0]?.follower).toBe(true);
    clock.advance(100);
    engine.tick();
    expect(of('roster').at(-1)?.[0]?.follower).toBe(true);
  });

  test('demo: có cả TTS lẫn chính thức; follow xong thì là chính thức', () => {
    const d = new DemoConnector(1000, Math.random);
    const seen = new Set<boolean>();
    for (let i = 0; i < 400; i++) {
      const e = d.next(i);
      seen.add(e.user.follower === true);
      if (e.kind === 'follow') expect(e.user.follower).toBe(true);
    }
    expect(seen.size).toBe(2);
  });
});
