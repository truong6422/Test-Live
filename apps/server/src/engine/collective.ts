import type { CollectiveConfig, CollectiveState } from '@cau/shared';

/** Mỗi người góp tối đa chừng này lượt vào một vòng sự kiện tập thể. */
export const MAX_CONTRIBUTIONS_PER_USER = 3;

export type CollectiveTick = { kind: 'expired'; state: CollectiveState } | { kind: 'started'; state: CollectiveState } | null;

/**
 * Sự kiện tập thể (MVP: một nhiệm vụ lặp lại, ví dụ "Cả hồ kéo Cá Thần").
 * Mỗi lượt tham gia hợp lệ cộng 1 vào tiến trình. Đủ mục tiêu -> completed,
 * nghỉ restartDelayMs rồi mở vòng mới.
 */
export class CollectiveTracker {
  private state: CollectiveState | null = null;
  private contributors = new Set<string>();
  /** Số lượt đã góp của từng người trong vòng hiện tại. */
  private perUser = new Map<string, number>();
  private nextStartAt: number | null = null;

  constructor(
    private cfg: CollectiveConfig,
    private newId: () => string
  ) {}

  setConfig(cfg: CollectiveConfig, now: number): void {
    const goalChanged = cfg.goal !== this.cfg.goal;
    this.cfg = cfg;
    if (!cfg.enabled) {
      this.state = null;
      this.nextStartAt = null;
      return;
    }
    if (this.state && this.state.status === 'active') {
      this.state = { ...this.state, name: cfg.name, description: cfg.description, goal: cfg.goal };
      if (goalChanged && this.state.progress >= cfg.goal) this.state.progress = cfg.goal - 1;
    } else if (!this.state) {
      this.start(now);
    }
  }

  get config(): CollectiveConfig {
    return this.cfg;
  }

  get current(): CollectiveState | null {
    return this.state;
  }

  get contributorIds(): string[] {
    return [...this.contributors];
  }

  start(now: number): CollectiveState | null {
    if (!this.cfg.enabled) return null;
    this.contributors.clear();
    this.perUser.clear();
    this.nextStartAt = null;
    this.state = {
      roundId: this.newId(),
      name: this.cfg.name,
      description: this.cfg.description,
      goal: this.cfg.goal,
      progress: 0,
      participants: 0,
      status: 'active',
      startedAt: now,
      endsAt: this.cfg.durationMs > 0 ? now + this.cfg.durationMs : null
    };
    return this.state;
  }

  /**
   * Ghi nhận một lượt đóng góp. Trả về 'completed' đúng một lần khi vừa đạt mục tiêu.
   * Mỗi người góp tối đa MAX_CONTRIBUTIONS_PER_USER lượt mỗi vòng (một người spam không tự hoàn thành mục tiêu);
   * vượt mức thì trả về null.
   */
  contribute(userKey: string, now: number): 'progress' | 'completed' | null {
    const s = this.state;
    if (!s || s.status !== 'active') return null;
    if (s.endsAt !== null && now >= s.endsAt) return null;
    const mine = this.perUser.get(userKey) ?? 0;
    if (mine >= MAX_CONTRIBUTIONS_PER_USER) return null;
    this.perUser.set(userKey, mine + 1);
    this.contributors.add(userKey);
    s.progress = Math.min(s.goal, s.progress + 1);
    s.participants = this.contributors.size;
    if (s.progress >= s.goal) {
      s.status = 'completed';
      this.nextStartAt = now + this.cfg.restartDelayMs;
      return 'completed';
    }
    return 'progress';
  }

  tick(now: number): CollectiveTick {
    const s = this.state;
    if (!this.cfg.enabled) return null;
    if (s && s.status === 'active' && s.endsAt !== null && now >= s.endsAt) {
      s.status = 'expired';
      this.nextStartAt = now + this.cfg.restartDelayMs;
      return { kind: 'expired', state: s };
    }
    if (this.nextStartAt !== null && now >= this.nextStartAt) {
      const started = this.start(now);
      return started ? { kind: 'started', state: started } : null;
    }
    return null;
  }

  reset(now: number): void {
    this.state = null;
    this.start(now);
  }
}
