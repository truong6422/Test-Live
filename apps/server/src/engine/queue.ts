import type { Lane } from '@cau/shared';

export interface QueueItem<T = unknown> {
  actionId: string;
  lanes: Lane[];
  priority: number;
  enqueuedAt: number;
  seq: number;
  payload: T;
}

export type PushResult<T> =
  | { ok: true; dropped: QueueItem<T> | null }
  | { ok: false };

/**
 * Hàng đợi ưu tiên có giới hạn.
 * - Lấy ra: mục ưu tiên cao nhất mà lane đang rảnh; cùng ưu tiên thì mục cũ hơn trước.
 * - Đầy: nếu mục mới ưu tiên cao hơn mục thấp nhất -> bỏ mục thấp nhất; ngược lại từ chối mục mới.
 */
export class ActionQueue<T = unknown> {
  private items: QueueItem<T>[] = [];
  private seq = 0;

  constructor(private maxSize: number) {}

  setMaxSize(n: number): void {
    this.maxSize = n;
  }

  get length(): number {
    return this.items.length;
  }

  push(item: Omit<QueueItem<T>, 'seq'>): PushResult<T> {
    const full: QueueItem<T> = { ...item, seq: ++this.seq };
    if (this.items.length < this.maxSize) {
      this.items.push(full);
      return { ok: true, dropped: null };
    }
    const lowestIdx = this.lowestIndex();
    const lowest = this.items[lowestIdx];
    if (!lowest || lowest.priority >= full.priority) return { ok: false };
    this.items.splice(lowestIdx, 1);
    this.items.push(full);
    return { ok: true, dropped: lowest };
  }

  /**
   * Lấy mục tốt nhất có thể chạy với các lane đang bận.
   * Mục ưu tiên cao hơn mà đang bị chặn sẽ "giữ chỗ" lane của nó, để mục thấp hơn
   * không chen vào làm nó chờ mãi (ví dụ "Cả hồ kéo Cá Thần" cần mọi lane).
   */
  popRunnable(busy: ReadonlySet<Lane>): QueueItem<T> | null {
    const order = this.items
      .map((it, idx) => ({ it, idx }))
      .sort((a, b) => b.it.priority - a.it.priority || a.it.seq - b.it.seq);
    const blocked = new Set<Lane>(busy);
    for (const { it, idx } of order) {
      if (it.lanes.some((l) => blocked.has(l))) {
        it.lanes.forEach((l) => blocked.add(l));
        continue;
      }
      return this.items.splice(idx, 1)[0] ?? null;
    }
    return null;
  }

  /** Gỡ các mục chờ quá lâu. */
  removeExpired(now: number, maxWaitMs: number): QueueItem<T>[] {
    const expired: QueueItem<T>[] = [];
    this.items = this.items.filter((it) => {
      if (now - it.enqueuedAt > maxWaitMs) {
        expired.push(it);
        return false;
      }
      return true;
    });
    return expired;
  }

  /** Gỡ mọi mục thoả điều kiện, trả về các mục đã gỡ. */
  removeWhere(pred: (it: QueueItem<T>) => boolean): QueueItem<T>[] {
    const removed: QueueItem<T>[] = [];
    this.items = this.items.filter((it) => {
      if (!pred(it)) return true;
      removed.push(it);
      return false;
    });
    return removed;
  }

  /** Các mục đang chờ (bản sao, chỉ đọc). */
  pending(): readonly QueueItem<T>[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  private lowestIndex(): number {
    let idx = 0;
    for (let i = 1; i < this.items.length; i++) {
      const a = this.items[i]!;
      const b = this.items[idx]!;
      // thấp nhất; cùng ưu tiên thì bỏ mục mới hơn (giữ người đến trước)
      if (a.priority < b.priority || (a.priority === b.priority && a.seq > b.seq)) idx = i;
    }
    return idx;
  }
}
