import { describe, expect, test } from 'bun:test';
import { ROSTER_MAX } from '@cau/shared';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import { TikTokNormalizer } from '../src/normalizer/tiktok-normalizer';
import { PlayerRegistry } from '../src/players/players';
import { ev, makeEngine } from './helpers';

const u = (id: string, follower?: boolean) => ({ platformId: id, username: id, displayName: `Tên ${id}`, follower });

describe('Follow → cần thủ chính thức', () => {
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

  test('registry: follow giữ nguyên trong phiên; chỉ người đã vào hồ mới có trong roster', () => {
    const r = new PlayerRegistry();
    r.participate(u('a', true), 1);
    r.join('a', 0);
    r.participate(u('b'), 1);
    r.join('b', 0);
    r.participate(u('a', false), 1); // lần sau TikTok báo false/không rõ → vẫn chính thức
    r.participate(u('c'), 1); // chỉ thả tim → không ngồi câu
    expect(r.roster().map((m) => [m.platformId, m.follower]).sort()).toEqual([
      ['a', true],
      ['b', false]
    ]);
    expect(r.markFollower('b')).toBe(true);
    expect(r.markFollower('b')).toBe(false);
    expect(r.roster().find((m) => m.platformId === 'b')?.follower).toBe(true);
    r.resetSession();
    expect(r.roster()).toEqual([]);
  });

  test(`hồ tối đa ${ROSTER_MAX} người; đầy thì người lâu không hoạt động nhất rời chỗ`, () => {
    expect(ROSTER_MAX).toBe(50);
    const r = new PlayerRegistry();
    const evicted: (string | null)[] = [];
    for (let i = 0; i < ROSTER_MAX + 10; i++) {
      r.participate(u(`p${i}`), 1);
      evicted.push(r.join(`p${i}`, i));
    }
    const roster = r.roster();
    expect(roster).toHaveLength(ROSTER_MAX);
    expect(evicted.filter(Boolean)).toEqual(Array.from({ length: 10 }, (_, i) => `p${i}`));
    expect(roster.some((m) => m.platformId === `p${ROSTER_MAX + 9}`)).toBe(true);
    expect(roster.some((m) => m.platformId === 'p0')).toBe(false);
  });

  test('engine: sự kiện follow chuyển tập sự thành chính thức và phát roster có seat/kg', () => {
    const { engine, clock, of } = makeEngine();
    engine.ingest(ev({ kind: 'comment', text: 'hello', user: u('x') }));
    expect(engine.snapshot().roster[0]).toMatchObject({ platformId: 'x', follower: false, seat: 'front', kg: 0, diamonds: 0 });
    engine.ingest(ev({ kind: 'follow', user: u('x') }));
    expect(engine.snapshot().roster[0]?.follower).toBe(true);
    clock.advance(100);
    engine.tick();
    expect(of('roster').at(-1)?.[0]?.follower).toBe(true);
  });

  test('demo: có cả tập sự lẫn chính thức; follow xong thì là chính thức', () => {
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
