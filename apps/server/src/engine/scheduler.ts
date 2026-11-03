import type { Lane, RunningAction } from '@cau/shared';

/**
 * Điều phối hoạt ảnh phía server: theo dõi hoạt ảnh đang chạy, khoá lane, giới hạn số chạy cùng lúc
 * (engine dùng 1 — hành động chạy nối tiếp).
 * Overlay chỉ vẽ theo lệnh action.started / action.ended.
 */
export class AnimationScheduler {
  private running = new Map<string, RunningAction>();

  constructor(private maxConcurrent: number) {}

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = n;
  }

  busyLanes(): Set<Lane> {
    const set = new Set<Lane>();
    for (const r of this.running.values()) r.lanes.forEach((l) => set.add(l));
    return set;
  }

  hasCapacity(): boolean {
    return this.running.size < this.maxConcurrent;
  }

  canRun(lanes: readonly Lane[]): boolean {
    if (!this.hasCapacity()) return false;
    const busy = this.busyLanes();
    return !lanes.some((l) => busy.has(l));
  }

  start(action: RunningAction): void {
    if (!this.canRun(action.lanes)) {
      throw new Error(`Lane xung đột hoặc vượt giới hạn song song: ${action.actionId}`);
    }
    this.running.set(action.runId, action);
  }

  /** Gỡ các hoạt ảnh đã hết thời lượng, trả về danh sách vừa kết thúc. */
  finishDue(now: number): RunningAction[] {
    const done: RunningAction[] = [];
    for (const [id, r] of this.running) {
      if (now >= r.startedAt + r.durationMs) {
        this.running.delete(id);
        done.push(r);
      }
    }
    return done;
  }

  list(): RunningAction[] {
    return [...this.running.values()];
  }

  get size(): number {
    return this.running.size;
  }

  clear(): RunningAction[] {
    const all = this.list();
    this.running.clear();
    return all;
  }
}
