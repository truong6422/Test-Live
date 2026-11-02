/**
 * Bộ chống xử lý trùng: nhớ ID sự kiện trong `ttlMs`, tối đa `maxSize` mục (LRU theo thời điểm thêm).
 * Cần thiết vì khi reconnect, connector có thể phát lại các tin nhắn cũ.
 */
export class Deduper {
  private seen = new Map<string, number>();

  constructor(
    private readonly maxSize = 5000,
    private readonly ttlMs = 10 * 60_000
  ) {}

  /** Trả về true nếu ID đã thấy (=> bỏ qua). Ngược lại ghi nhận và trả false. */
  isDuplicate(id: string, now: number): boolean {
    const at = this.seen.get(id);
    if (at !== undefined && now - at < this.ttlMs) return true;
    if (at !== undefined) this.seen.delete(id);
    this.seen.set(id, now);
    this.evict(now);
    return false;
  }

  private evict(now: number): void {
    while (this.seen.size > this.maxSize) {
      const first = this.seen.keys().next().value as string;
      this.seen.delete(first);
    }
    // Dọn mục hết hạn ở đầu (Map giữ thứ tự chèn).
    for (const [key, at] of this.seen) {
      if (now - at < this.ttlMs) break;
      this.seen.delete(key);
    }
  }

  get size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }
}
