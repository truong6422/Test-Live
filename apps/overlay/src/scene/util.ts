export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Tiến trình con trong khoảng [from, to] của tiến trình tổng p (0..1). */
export const seg = (p: number, from: number, to: number) => clamp01((p - from) / (to - from));

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeIn = (t: number) => t * t * t;

/** Nhấp nhô khi đi bộ. */
export const bob = (ms: number, speed = 0.02, amp = 6) => Math.abs(Math.sin(ms * speed)) * -amp;
