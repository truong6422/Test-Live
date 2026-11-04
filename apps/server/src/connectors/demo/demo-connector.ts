import { demoNames, type NormalizedEvent } from '@cau/shared';
import type { ConnectorEventListener } from '../types';

/** ~110 tên giả kiểu tài khoản TikTok Việt để thử hồ đông người (chỉ chế độ demo, luôn có nhãn DEMO). */
const DEMO_ANGLERS = demoNames(110);

/** Bình luận demo: việc vui + tán gẫu (bình luận bất kỳ là vào hồ câu). */
const DEMO_COMMENTS = [
  'câu thôi', 'thay mồi', 'móc mồi giun', 'trà đá nào', 'uống trà', 'nghỉ chút', 'khoe cá nè', 'sống ảo tí', 'check in hồ',
  'hát hò cho cá nghe', 'ca hát nào', 'buồn ngủ quá', 'ngủ gật mất', 'hello cả hồ', 'cá cắn câu chưa',
  'haha', 'hôm nay được mùa', 'phao nhúc nhích kìa'
];

/**
 * Quà demo với giá trị kim cương gần đúng TikTok, để chế độ demo chạy qua mọi bậc kéo cá to.
 * `weight` = tần suất tương đối (quà rẻ xuất hiện nhiều hơn).
 */
const DEMO_GIFTS = [
  { giftId: 5655, name: 'Rose', diamonds: 1, counts: [1, 1, 1, 3, 5, 10, 12], weight: 10 },
  { giftId: 7934, name: 'Heart Me', diamonds: 1, counts: [1, 1, 2], weight: 4 },
  { giftId: 5269, name: 'TikTok', diamonds: 1, counts: [1], weight: 3 },
  { giftId: 6064, name: 'GG', diamonds: 1, counts: [1, 5], weight: 3 },
  { giftId: 5487, name: 'Finger Heart', diamonds: 5, counts: [1, 1, 2], weight: 5 },
  { giftId: 5658, name: 'Perfume', diamonds: 20, counts: [1], weight: 3 },
  { giftId: 5879, name: 'Doughnut', diamonds: 30, counts: [1, 1, 2], weight: 3 },
  { giftId: 6427, name: 'Hat and Mustache', diamonds: 99, counts: [1, 1, 2, 3], weight: 2 },
  { giftId: 6267, name: 'Corgi', diamonds: 299, counts: [1], weight: 1 },
  { giftId: 7168, name: 'Money Gun', diamonds: 500, counts: [1], weight: 1 }
];
const GIFT_WEIGHT_TOTAL = DEMO_GIFTS.reduce((s, g) => s + g.weight, 0);

/**
 * Bình luận tán gẫu trung tính (profile 'live'). Không có câu giả làm người xem thật (quê quán, "lần đầu xem"…)
 * hay câu gợi ý tặng quà / hỏi cách lên Bến Vàng.
 */
const LIVE_COMMENTS = [
  'alo alo', 'hello cả nhà', 'ủa đây là gì vậy', 'câu sao vậy ad', 'cho mình vào câu với', 'vào câu nè',
  'ae vào câu cá nè', 'cá to quá', 'chúc mừng nha', 'hay ghê', 'ghé chơi nè', 'tối nay câu được con gì',
  'hehe', 'đẹp quá', 'nhạc gì vậy ad', 'buồn ngủ quá',
  'câu lâu chưa được con nào 😭', 'phao động kìa', '❤️', '😂😂', 'ad ơi', 'tui lên cá rồi'
];
/** Quà khi giả lập LIVE thật: gần như toàn quà nhỏ, quà to rất hiếm. */
const LIVE_GIFT_WEIGHT = (diamonds: number) => (diamonds <= 1 ? 30 : diamonds <= 5 ? 6 : diamonds <= 30 ? 2 : diamonds <= 99 ? 0.6 : 0.15);

/**
 * Cách sinh sự kiện demo:
 *  - 'busy': dồn dập (1 sự kiện / ~1,2s, nhiều quà) để thử mọi hoạt ảnh và hồ đông người.
 *  - 'live': giống một phiên LIVE nhỏ thật — người xem vào dần (≈ 3 người mới / phút), 1,5–4,5s một sự kiện,
 *    chủ yếu bình luận + thả tim, quà ≈ 4% và gần như toàn quà 1 xu.
 */
export type DemoProfile = 'busy' | 'live';
export const DEMO_PROFILES = ['busy', 'live'] as const satisfies readonly DemoProfile[];

const pickGift = (rnd: () => number) => {
  let r = rnd() * GIFT_WEIGHT_TOTAL;
  for (const g of DEMO_GIFTS) {
    r -= g.weight;
    if (r < 0) return g;
  }
  return DEMO_GIFTS[0]!;
};

const pick = <T>(arr: readonly T[], rnd: () => number): T => arr[Math.floor(rnd() * arr.length)]!;

/**
 * Chế độ demo: sinh sự kiện giả lập để thử overlay + engine khi không có TikTok LIVE.
 * Mọi sự kiện đều mang source = 'demo' và user ID tiền tố 'demo:' — không bao giờ giả làm sự kiện TikTok,
 * không được lưu vào bảng cần thủ, và overlay hiện nhãn DEMO khi chế độ này bật.
 */
export class DemoConnector {
  readonly name = 'demo';
  private timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
  private listeners: ConnectorEventListener[] = [];
  private seq = 0;
  private profile: DemoProfile = 'busy';
  private startedAt = 0;
  /** Tăng mỗi lần start/stop — vòng setTimeout của lần chạy cũ tự dừng. */
  private generation = 0;
  /** Người xem demo đã follow (1/3 có sẵn, số còn lại follow dần qua sự kiện follow). */
  private followers = new Set(DEMO_ANGLERS.map((_, i) => i).filter((i) => i % 3 === 0));

  constructor(
    private intervalMs = 1200,
    private rnd: () => number = Math.random
  ) {}

  onEvent(fn: ConnectorEventListener): void {
    this.listeners.push(fn);
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get mode(): DemoProfile {
    return this.profile;
  }

  /** Đổi profile + mốc bắt đầu mà không bật timer (start() gọi; test gọi trực tiếp với `now` giả). */
  setProfile(profile: DemoProfile, now = Date.now()): void {
    this.profile = profile;
    this.startedAt = now;
  }

  start(profile: DemoProfile = 'busy'): void {
    if (this.timer) this.stop();
    this.setProfile(profile);
    const gen = ++this.generation;
    if (profile === 'busy') {
      this.timer = setInterval(() => this.emitOne(), this.intervalMs);
      return;
    }
    const loop = () => {
      // stop() / start() mới trong lúc chờ → vòng cũ dừng hẳn, không tự hồi sinh timer.
      if (gen !== this.generation) return;
      try {
        this.emitOne();
      } finally {
        if (gen === this.generation) this.timer = setTimeout(loop, 1500 + this.rnd() * 3000);
      }
    };
    this.timer = setTimeout(loop, 800);
  }

  stop(): void {
    this.generation++;
    if (this.timer) {
      clearInterval(this.timer as ReturnType<typeof setInterval>);
      clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    }
    this.timer = null;
  }

  /** Sinh một sự kiện (public để test). */
  next(now = Date.now()): NormalizedEvent {
    if (this.profile === 'live') return this.nextLive(now);
    this.seq += 1;
    const idx = Math.floor(this.rnd() * DEMO_ANGLERS.length);
    const user = {
      platformId: `demo:${idx}`,
      username: `demo_${idx}`,
      displayName: DEMO_ANGLERS[idx]!,
      follower: this.followers.has(idx)
    };
    const base = { id: `demo:${now}:${this.seq}`, source: 'demo' as const, user, receivedAt: now };
    const roll = this.rnd();
    if (roll < 0.55) return { ...base, kind: 'comment', text: pick(DEMO_COMMENTS, this.rnd) };
    if (roll < 0.72) return { ...base, kind: 'like', likeCount: 1 + Math.floor(this.rnd() * 15) };
    if (roll < 0.94) {
      const g = pickGift(this.rnd);
      return { ...base, kind: 'gift', gift: { giftId: g.giftId, name: g.name, diamonds: g.diamonds, count: pick(g.counts, this.rnd) } };
    }
    if (this.rnd() < 0.5) return { ...base, kind: 'share' };
    this.followers.add(idx);
    return { ...base, kind: 'follow', user: { ...user, follower: true } };
  }

  /** Một sự kiện kiểu LIVE thật: nhóm người xem lớn dần theo thời gian, người vào trước hay nói hơn. */
  private nextLive(now: number): NormalizedEvent {
    this.seq += 1;
    const minutes = Math.max(0, (now - this.startedAt) / 60_000);
    const pool = Math.min(DEMO_ANGLERS.length, 3 + Math.floor(minutes * 3));
    // r² dồn về người vào sớm (khách quen), thỉnh thoảng có người mới nhất vừa vào
    const idx = this.rnd() < 0.15 ? pool - 1 : Math.floor(this.rnd() ** 2 * pool);
    const user = {
      platformId: `demo:${idx}`,
      username: `demo_${idx}`,
      displayName: DEMO_ANGLERS[idx]!,
      follower: this.followers.has(idx)
    };
    const base = { id: `demo:${now}:${this.seq}`, source: 'demo' as const, user, receivedAt: now };
    const roll = this.rnd();
    if (roll < 0.7) return { ...base, kind: 'comment', text: pick(LIVE_COMMENTS, this.rnd) };
    if (roll < 0.88) return { ...base, kind: 'like', likeCount: 1 + Math.floor(this.rnd() * 10) };
    if (roll < 0.92) {
      const total = DEMO_GIFTS.reduce((s, g) => s + LIVE_GIFT_WEIGHT(g.diamonds), 0);
      let r = this.rnd() * total;
      const g = DEMO_GIFTS.find((x) => (r -= LIVE_GIFT_WEIGHT(x.diamonds)) < 0) ?? DEMO_GIFTS[0]!;
      return { ...base, kind: 'gift', gift: { giftId: g.giftId, name: g.name, diamonds: g.diamonds, count: 1 } };
    }
    if (roll < 0.95) return { ...base, kind: 'share' };
    this.followers.add(idx);
    return { ...base, kind: 'follow', user: { ...user, follower: true } };
  }

  private emitOne(): void {
    const e = this.next();
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // listener lỗi không được làm chết vòng demo (timer vẫn chạy, `running` vẫn đúng)
      }
    }
  }
}
