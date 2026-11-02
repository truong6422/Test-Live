import type { NormalizedEvent } from '@sep/shared';
import type { ConnectorEventListener } from '../types';

const FIRST = ['Lan', 'Hùng', 'Mai', 'Tuấn', 'Linh', 'Phát', 'Hà', 'Nam', 'Thảo', 'Quân', 'Vy', 'Đức'];
const ROLE = ['Kế Toán', 'IT', 'Nhân Sự', 'Sales', 'Marketing', 'Thực Tập', 'Hành Chính', 'Dev', 'Design', 'Kho'];
/** 120 tên giả để thử overlay đông người. */
const DEMO_STAFF = FIRST.flatMap((f) => ROLE.map((r) => `${f} ${r}`));

/** Bình luận demo: công việc miễn phí + tán gẫu (trêu Sếp giờ chỉ bằng quà). */
const DEMO_COMMENTS = [
  'làm việc thôi', 'nộp báo cáo', 'tăng ca', 'pha cà phê', 'xin nghỉ', 'họp nhóm', 'chạy deadline', 'báo cáo đây',
  'hello cả nhà', 'em xin nghỉ phép', 'deadline dí quá', 'sếp đâu rồi', 'haha', 'đình công!!!',
  'tặng quà phá sếp nào', 'sếp ơi em xin nghỉ'
];

/**
 * Quà demo với giá trị kim cương gần đúng TikTok, để chế độ demo chạy qua mọi bậc trêu Sếp.
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
 * không được lưu vào bảng nhân viên, và overlay hiện nhãn DEMO khi chế độ này bật.
 */
export class DemoConnector {
  readonly name = 'demo';
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: ConnectorEventListener[] = [];
  private seq = 0;
  /** Người xem demo đã follow (1/3 có sẵn, số còn lại follow dần qua sự kiện follow). */
  private followers = new Set(DEMO_STAFF.map((_, i) => i).filter((i) => i % 3 === 0));

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

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.emitOne(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sinh một sự kiện (public để test). */
  next(now = Date.now()): NormalizedEvent {
    this.seq += 1;
    const idx = Math.floor(this.rnd() * DEMO_STAFF.length);
    const user = {
      platformId: `demo:${idx}`,
      username: `demo_${idx}`,
      displayName: DEMO_STAFF[idx]!,
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

  private emitOne(): void {
    const e = this.next();
    for (const fn of this.listeners) fn(e);
  }
}
