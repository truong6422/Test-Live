/** Token bucket đơn giản. */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }

  take(now: number, cost = 1): boolean {
    this.refill(now);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** true khi bucket đã đầy lại — dùng để dọn bucket không còn hoạt động. */
  isFull(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.capacity;
  }

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.updatedAt = now;
  }
}

export interface RateLimitOptions {
  userCapacity: number;
  userRefillPerSec: number;
  globalCapacity: number;
  globalRefillPerSec: number;
  maxTrackedUsers?: number;
}

/** Giới hạn tần suất theo từng người + toàn cục. */
export class RateLimiter {
  private users = new Map<string, TokenBucket>();
  private global: TokenBucket;

  constructor(private opts: RateLimitOptions, now: number) {
    this.global = new TokenBucket(opts.globalCapacity, opts.globalRefillPerSec, now);
  }

  allow(userKey: string, now: number): boolean {
    let bucket = this.users.get(userKey);
    if (!bucket) {
      bucket = new TokenBucket(this.opts.userCapacity, this.opts.userRefillPerSec, now);
      this.users.set(userKey, bucket);
      this.prune(now);
    }
    // Kiểm tra người dùng trước để một người spam không tiêu hết quota toàn cục.
    if (!bucket.take(now)) return false;
    return this.global.take(now);
  }

  private prune(now: number): void {
    const max = this.opts.maxTrackedUsers ?? 5000;
    if (this.users.size <= max) return;
    for (const [key, bucket] of this.users) {
      if (bucket.isFull(now)) this.users.delete(key);
      if (this.users.size <= max * 0.8) break;
    }
    while (this.users.size > max) {
      this.users.delete(this.users.keys().next().value as string);
    }
  }
}
