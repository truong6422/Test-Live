export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Đồng hồ điều khiển tay cho test. */
export class ManualClock implements Clock {
  constructor(private t = 1_000_000) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(t: number): void {
    this.t = t;
  }
}
