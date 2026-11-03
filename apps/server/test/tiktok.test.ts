import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { NormalizedEvent } from '@cau/shared';
import { TikTokConnector, type LiveConnectionLike } from '../src/connectors/tiktok/tiktok-connector';
import { silentLogger } from '../src/logger';
import { cleanAvatarUrl, cleanComment, cleanDisplayName } from '../src/normalizer/sanitize';
import { parseTikTokUsername, TikTokNormalizer, type TtGift } from '../src/normalizer/tiktok-normalizer';

// Mẫu dữ liệu theo hình dạng message của tiktok-live-connector 2.5 (tiktok-live-proto v3).
const user = { id: '7001', displayId: 'lan.ketoan', nickname: 'Lan 🌸', avatarThumb: { urlList: ['https://p16.tiktokcdn.com/a.webp'] } };
const giftMsg = (msgId: string, repeatCount: number, repeatEnd: number, type = 1): TtGift => ({
  common: { msgId },
  user,
  giftId: '5655',
  repeatCount,
  repeatEnd,
  groupId: 'g-1',
  gift: { name: 'Rose', diamondCount: 1, type }
});

describe('TikTokNormalizer', () => {
  test('chat -> comment, dùng msgId làm ID chống trùng', () => {
    const n = new TikTokNormalizer();
    const e = n.chat({ common: { msgId: 'm1' }, user, content: '  đổ   cà phê [smile] ' }, 0)!;
    expect(e).toMatchObject({
      id: 'tt:m1',
      source: 'tiktok',
      kind: 'comment',
      text: 'đổ cà phê',
      user: { platformId: '7001', username: 'lan.ketoan', displayName: 'Lan 🌸' }
    });
    expect(e.user.avatarUrl).toStartWith('https://');
  });

  test('bỏ message thiếu người gửi hoặc nội dung rỗng', () => {
    const n = new TikTokNormalizer();
    expect(n.chat({ content: 'hi' }, 0)).toBeNull();
    expect(n.chat({ user, content: '   ' }, 0)).toBeNull();
  });

  test('gift streak: chỉ phát một lần khi repeatEnd, với số lượng cuối', () => {
    const n = new TikTokNormalizer();
    expect(n.gift(giftMsg('a', 1, 0), 0)).toBeNull();
    expect(n.gift(giftMsg('b', 5, 0), 100)).toBeNull();
    expect(n.gift(giftMsg('c', 9, 0), 200)).toBeNull();
    const done = n.gift(giftMsg('d', 9, 1), 300)!;
    expect(done.gift).toEqual({ giftId: 5655, name: 'Rose', count: 9, diamonds: 1 });
    expect(done.id).toBe('tt:d');
    expect(n.pendingStreaks).toBe(0);
  });

  test('quà không combo phát ngay', () => {
    const n = new TikTokNormalizer();
    const e = n.gift(giftMsg('x', 1, 0, 0), 0)!;
    expect(e.gift?.count).toBe(1);
    expect(e.id).toBe('tt:x');
  });

  test('streak không có repeatEnd được chốt sau timeout; repeatEnd đến muộn bị bỏ qua', () => {
    const n = new TikTokNormalizer({ streakTimeoutMs: 1000 });
    n.gift(giftMsg('a', 3, 0), 0);
    expect(n.flushStale(500)).toHaveLength(0);
    const flushed = n.flushStale(1000);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.gift?.count).toBe(3);
    expect(n.gift(giftMsg('late', 3, 1), 1200)).toBeNull();
    // streak mới cùng group sau đó vẫn hoạt động bình thường
    expect(n.gift(giftMsg('new', 1, 1), 1300)?.gift?.count).toBe(1);
  });

  test('like, share, follow', () => {
    const n = new TikTokNormalizer();
    expect(n.like({ common: { msgId: 'l' }, user, count: 7 }, 0)?.likeCount).toBe(7);
    expect(n.social('share', { common: { msgId: 's' }, user }, 0)?.kind).toBe('share');
    expect(n.social('follow', { common: { msgId: 'f' }, user }, 0)?.kind).toBe('follow');
  });

  test('parseTikTokUsername', () => {
    expect(parseTikTokUsername('@sep.oi_123')).toBe('sep.oi_123');
    expect(parseTikTokUsername('https://www.tiktok.com/@kenh.vui/live?x=1')).toBe('kenh.vui');
    expect(parseTikTokUsername('http://169.254.169.254/')).toBeNull();
    expect(parseTikTokUsername('a')).toBeNull();
  });

  test('làm sạch tên và avatar', () => {
    expect(cleanDisplayName('𒐫𒐫𒐫', 'fallback')).toBe('fallback');
    expect(cleanDisplayName('a‮b', 'x')).toBe('ab');
    expect(cleanDisplayName('Z̴̡̢a̵̧l̶g̷o', 'x')).toBe('Zalgo');
    expect(cleanAvatarUrl('javascript:alert(1)')).toBeUndefined();
    // Từ tục bị che, từ thường gần giống (bỏ dấu trùng) thì giữ nguyên
    expect(cleanDisplayName('Anh ĐM!! Câu', 'x')).toBe('Anh *** Câu');
    expect(cleanComment('cá lớn các bác ơi vcl')).toBe('cá lớn các bác ơi ***');
    expect(cleanAvatarUrl('http://x/a.png')).toBeUndefined();
  });
});

class FakeConn extends EventEmitter implements LiveConnectionLike {
  connected = false;
  constructor(private result: () => Promise<{ roomId: string }>) {
    super();
  }
  async connect() {
    const r = await this.result();
    this.connected = true;
    return r;
  }
  async disconnect() {
    this.connected = false;
    this.emit('disconnected');
  }
}

describe('TikTokConnector', () => {
  const setup = (results: (() => Promise<{ roomId: string }>)[]) => {
    const conns: FakeConn[] = [];
    let i = 0;
    const c = new TikTokConnector({
      logger: silentLogger,
      factory: () => {
        const fc = new FakeConn(results[Math.min(i++, results.length - 1)]!);
        conns.push(fc);
        return fc;
      },
      baseDelayMs: 5,
      maxDelayMs: 20,
      offlineRetryMs: 10,
      random: () => 0.5
    });
    const events: NormalizedEvent[] = [];
    c.onEvent((e) => events.push(e));
    return { c, conns, events };
  };
  const ok = () => Promise.resolve({ roomId: 'room1' });
  const fail = () => Promise.reject(new Error('socket hang up'));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test('kết nối và chuyển tiếp sự kiện đã chuẩn hoá', async () => {
    const { c, conns, events } = setup([ok]);
    await c.connect('@kenh.test');
    expect(c.state()).toMatchObject({ status: 'connected', username: 'kenh.test', roomId: 'room1' });
    conns[0]!.emit('chat', { common: { msgId: 'm' }, user, content: '1' });
    conns[0]!.emit('roomUser', { total: '321' });
    expect(events).toHaveLength(1);
    expect(c.state().viewerCount).toBe(321);
    await c.disconnect();
  });

  test('lỗi kết nối thì tự thử lại với backoff, thành công thì reset bộ đếm', async () => {
    const { c, conns } = setup([fail, fail, ok]);
    await c.connect('kenh.test');
    expect(c.state().status).toBe('error');
    await sleep(80);
    expect(conns.length).toBe(3);
    expect(c.state()).toMatchObject({ status: 'connected', reconnectAttempt: 0 });
    await c.disconnect();
  });

  test('mất kết nối giữa chừng thì reconnect; connection cũ không còn phát sự kiện', async () => {
    const { c, conns, events } = setup([ok]);
    await c.connect('kenh.test');
    conns[0]!.emit('disconnected');
    expect(c.state().status).toBe('reconnecting');
    await sleep(40);
    expect(conns.length).toBe(2);
    expect(c.state().status).toBe('connected');
    conns[0]!.emit('chat', { common: { msgId: 'old' }, user, content: 'x' });
    expect(events).toHaveLength(0);
    await c.disconnect();
  });

  test('ngắt kết nối chủ động thì không reconnect', async () => {
    const { c, conns } = setup([ok]);
    await c.connect('kenh.test');
    await c.disconnect();
    await sleep(40);
    expect(conns.length).toBe(1);
    expect(c.state().status).toBe('disconnected');
  });

  test('username sai thì báo lỗi ngay', async () => {
    const { c } = setup([ok]);
    await expect(c.connect('http://evil.local/')).rejects.toThrow();
  });
});
