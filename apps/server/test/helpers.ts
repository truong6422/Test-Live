import type { GameConfig, NormalizedEvent, ServerMessage } from '@sep/shared';
import { defaultGameConfig } from '../src/config/defaults';
import { ManualClock } from '../src/engine/clock';
import { GameEngine } from '../src/engine/engine';

let counter = 0;

/**
 * Tạo sự kiện test. Người dùng mặc định là nhân viên chính thức (đã follow) để bình luận "trêu Sếp" chạy được;
 * truyền `follower = false` (hoặc `partial.user`) để thử thực tập sinh chưa follow.
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

/** Cấu hình test: nới rate limit để không cản trở các test khác. */
export function testConfig(mut?: (c: GameConfig) => void): GameConfig {
  const c = defaultGameConfig();
  c.limits.userBucketCapacity = 1000;
  c.limits.globalBucketCapacity = 10000;
  c.collective.goal = 1000;
  mut?.(c);
  return c;
}

export function makeEngine(mut?: (c: GameConfig) => void) {
  const clock = new ManualClock();
  let id = 0;
  const engine = new GameEngine({ clock, config: testConfig(mut), newId: () => `id${++id}`, broadcastIntervalMs: 0 });
  const messages: ServerMessage[] = [];
  engine.subscribe((m) => messages.push(m));
  engine.start('s1');
  type DataOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>['data'];
  const of = <T extends ServerMessage['type']>(type: T): DataOf<T>[] =>
    messages.filter((m) => m.type === type).map((m) => m.data as DataOf<T>);
  return { engine, clock, messages, of };
}

/** Từ khoá bình luận của bản 1 (trước khi trêu Sếp chỉ bằng quà). */
export const LEGACY_COMMENT_KEYWORDS: Record<string, string[]> = {
  throw_paper: ['1', 'nem giay', 'vo giay', 'giay vo'],
  pluck_tree: ['2', 'vat la', 'cay phat tai', 'vat cay', 'hai loc', 'vat loc'],
  doodle_kpi: ['3', 've bay', 've bang', 'bang kpi', 'kpi'],
  flat_tire: ['4', 'xit lop', 'lop xe', 'xep lop'],
  lock_toilet: ['5', 'khoa wc', 'khoa toilet', 'nha ve sinh', 'wc', 'toilet'],
  crash_pc: ['6', 'treo may', 'sap may', 'hong may', 'may tinh'],
  complaint_call: ['7', 'phan nan', 'khach phan nan', 'goi dien'],
  praise_boss: ['8', 'ninh sep', 'khen sep', 'sep dep trai', 'yeu sep'],
  blackout: ['9', 'cup dien', 'ngat dien', 'cau dao', 'mat dien']
};

/**
 * Bật lại trigger bình luận kiểu bản 1 (admin vẫn làm được trên dashboard) — dùng cho các test cơ chế engine
 * (cooldown, hàng đợi, followersOnly…) cần kích hoạt hành động nhanh bằng bình luận.
 */
export function commentTriggers(c: GameConfig): void {
  for (const a of c.actions) {
    const kws = LEGACY_COMMENT_KEYWORDS[a.id];
    if (kws) a.trigger = { ...a.trigger, kinds: ['comment'], keywords: [...kws] };
  }
}

/** Như makeEngine nhưng các hành động trêu Sếp kích hoạt được bằng bình luận (xem `commentTriggers`). */
export function makeCommentEngine(mut?: (c: GameConfig) => void) {
  return makeEngine((c) => {
    commentTriggers(c);
    mut?.(c);
  });
}
