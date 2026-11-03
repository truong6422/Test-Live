import type { GameConfig, NormalizedEvent, ServerMessage } from '@cau/shared';
import { defaultGameConfig } from '../src/config/defaults';
import { ManualClock } from '../src/engine/clock';
import { GameEngine } from '../src/engine/engine';

let counter = 0;

/**
 * Tạo sự kiện test. Người dùng mặc định là cần thủ chính thức (đã follow) để bình luận kích hoạt hành động chạy được;
 * truyền `follower = false` (hoặc `partial.user`) để thử cần thủ tập sự chưa follow.
 */
export function ev(
  partial: Partial<NormalizedEvent> & { kind: NormalizedEvent['kind'] },
  user = 'u1',
  follower = true
): NormalizedEvent {
  counter += 1;
  return {
    id: partial.id ?? `e${counter}`,
    source: partial.source ?? 'demo',
    receivedAt: 0,
    user: partial.user ?? { platformId: user, username: user, displayName: `User ${user}`, follower },
    ...partial
  } as NormalizedEvent;
}

/** Quà test: `diamonds` kim cương một món × `count`. */
export const giftEv = (user: string, diamonds: number, count = 1, giftId = 9999, follower = false) =>
  ev({ kind: 'gift', gift: { giftId, name: `Quà ${diamonds}`, count, diamonds } }, user, follower);

/**
 * Cấu hình test: nới rate limit, tắt cá to định kỳ (test riêng bật lại) để không cản trở các test khác.
 */
export function testConfig(mut?: (c: GameConfig) => void): GameConfig {
  const c = defaultGameConfig();
  c.limits.userBucketCapacity = 1000;
  c.limits.globalBucketCapacity = 10000;
  c.collective.goal = 1000;
  c.fishing.bigFishEveryMs = 0;
  mut?.(c);
  return c;
}

/** Nguồn ngẫu nhiên xác định (LCG) hoặc cố định một giá trị. */
export function seededRandom(seed = 1): () => number {
  let x = seed;
  return () => (x = (x * 9301 + 49297) % 233280) / 233280;
}

export function makeEngine(mut?: (c: GameConfig) => void, random: () => number = () => 0.5) {
  const clock = new ManualClock();
  let id = 0;
  const engine = new GameEngine({ clock, config: testConfig(mut), newId: () => `id${++id}`, broadcastIntervalMs: 0, random });
  const messages: ServerMessage[] = [];
  engine.subscribe((m) => messages.push(m));
  engine.start('s1');
  type DataOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>['data'];
  const of = <T extends ServerMessage['type']>(type: T): DataOf<T>[] =>
    messages.filter((m) => m.type === type).map((m) => m.data as DataOf<T>);
  return { engine, clock, messages, of };
}

/** Từ khoá bình luận số 1–9 (admin có thể bật lại trigger bình luận trên dashboard). */
export const COMMENT_KEYWORDS: Record<string, string[]> = {
  pull_carp: ['1', 'keo ca chep'],
  pull_grass_carp: ['2', 'ca tram co'],
  pull_catfish: ['3', 'ca tre'],
  pull_stingray: ['4', 'ca duoi'],
  pull_arowana: ['5', 'ca rong'],
  pull_giant_catfish: ['6', 'ca lang'],
  pull_snakehead: ['7', 'ca loc'],
  pull_koi: ['8', 'ca koi'],
  pull_legend: ['9', 'ca than huyen thoai']
};

/**
 * Bật trigger bình luận cho các hành động kéo cá, kèm cooldown kiểu cũ (mặc định cooldown = 0) —
 * dùng cho các test cơ chế engine (cooldown, hàng đợi, followersOnly…) cần kích hoạt hành động nhanh bằng bình luận.
 */
export function commentTriggers(c: GameConfig): void {
  for (const a of c.actions) {
    const kws = COMMENT_KEYWORDS[a.id];
    if (!kws) continue;
    a.trigger = { ...a.trigger, kinds: ['comment'], keywords: [...kws] };
    a.cooldownMs = 4000;
    a.userCooldownMs = 15000;
  }
}

/** Như makeEngine nhưng các hành động kéo cá kích hoạt được bằng bình luận (xem `commentTriggers`). */
export function makeCommentEngine(mut?: (c: GameConfig) => void, random?: () => number) {
  return makeEngine((c) => {
    commentTriggers(c);
    mut?.(c);
  }, random);
}
