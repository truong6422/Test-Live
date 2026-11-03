import {
  containsKeyword,
  foldVietnamese,
  type ActionConfig,
  type GiftMapping,
  type GiftPayload,
  type NormalizedEvent,
  type WorkTask
} from '@cau/shared';

export interface MatchResult {
  action: ActionConfig;
  /** Mapping quà đã khớp (nếu sự kiện là gift). */
  gift?: GiftMapping;
  /** Độ dài (đã fold) của từ khoá khớp — chỉ có với bình luận. */
  keywordLength?: number;
}

/** Độ dài từ khoá dài nhất (đã fold) có trong chuỗi đã fold; 0 nếu không khớp. */
export function longestKeyword(folded: string, keywords: readonly string[]): number {
  let best = 0;
  for (const kw of keywords) {
    if (!containsKeyword(folded, kw)) continue;
    best = Math.max(best, foldVietnamese(kw).length);
  }
  return best;
}

/** Tổng giá trị (kim cương) của một lượt tặng = kim cương một món × số lượng sau khi gộp streak. */
export function giftValue(gift: GiftPayload): number {
  const v = Math.max(0, gift.diamonds || 0) * Math.max(0, gift.count || 0);
  return Number.isFinite(v) ? v : 0;
}

const minDiamondsOf = (g: GiftMapping) => g.minDiamonds ?? 0;

/**
 * Ánh xạ sự kiện -> hành động. Không kiểm tra enabled/cooldown (việc của engine).
 * - gift: theo bảng GiftMapping (chỉ mapping đang bật, minCount <= số lượng):
 *         1. mapping có đúng giftId thắng trước; không có thì xét các bậc giftId 0 (mọi quà khác);
 *         2. trong cùng nhóm, chọn bậc có minDiamonds cao nhất mà vẫn <= tổng giá trị (kim cương × số lượng),
 *            hoà thì minCount cao hơn thắng;
 *         3. tổng giá trị không rõ (0) → chọn bậc thấp nhất. Giá trị thấp hơn mọi bậc → không khớp.
 * - comment: theo từ khoá; nếu nhiều hành động cùng khớp, chọn từ khoá dài nhất (cụ thể nhất).
 * - like/share/follow: hành động đầu tiên có kind tương ứng trong trigger.kinds.
 */
export function matchAction(
  event: NormalizedEvent,
  actions: readonly ActionConfig[],
  gifts: readonly GiftMapping[]
): MatchResult | null {
  const byId = new Map(actions.map((a) => [a.id, a]));

  if (event.kind === 'gift') {
    if (!event.gift) return null;
    const count = event.gift.count;
    const value = giftValue(event.gift);
    const pick = (giftId: number) => {
      const candidates = gifts.filter((g) => g.enabled && g.giftId === giftId && g.minCount <= count && byId.has(g.actionId));
      if (value <= 0) {
        // Không rõ giá trị (nền tảng không gửi kim cương): lấy bậc thấp nhất.
        return candidates.sort((a, b) => minDiamondsOf(a) - minDiamondsOf(b) || b.minCount - a.minCount)[0];
      }
      return candidates
        .filter((g) => minDiamondsOf(g) <= value)
        .sort((a, b) => minDiamondsOf(b) - minDiamondsOf(a) || b.minCount - a.minCount)[0];
    };
    const mapping = pick(event.gift.giftId) ?? pick(0);
    if (!mapping) return null;
    return { action: byId.get(mapping.actionId)!, gift: mapping };
  }

  if (event.kind === 'comment') {
    const folded = foldVietnamese(event.text ?? '');
    if (!folded) return null;
    let best: { action: ActionConfig; len: number } | null = null;
    for (const action of actions) {
      if (!action.trigger.kinds.includes('comment')) continue;
      const len = longestKeyword(folded, action.trigger.keywords);
      if (len > 0 && (!best || len > best.len)) best = { action, len };
    }
    return best ? { action: best.action, keywordLength: best.len } : null;
  }

  if (event.kind === 'like' || event.kind === 'share' || event.kind === 'follow') {
    const kind = event.kind;
    const action = actions.find((a) => a.trigger.kinds.includes(kind));
    return action ? { action } : null;
  }

  return null;
}

/** Công việc (đang bật) khớp bình luận, chọn từ khoá dài nhất. */
export function matchWork(text: string | undefined, tasks: readonly WorkTask[]): { task: WorkTask; keywordLength: number } | null {
  const folded = foldVietnamese(text ?? '');
  if (!folded) return null;
  let best: { task: WorkTask; keywordLength: number } | null = null;
  for (const task of tasks) {
    if (!task.enabled) continue;
    const len = longestKeyword(folded, task.keywords);
    if (len > 0 && (!best || len > best.keywordLength)) best = { task, keywordLength: len };
  }
  return best;
}
