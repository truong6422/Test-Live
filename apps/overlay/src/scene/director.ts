import type { Mood, RunningAction } from '@sep/shared';
import { createAnim, type ActionAnim } from './animations';
import type { SceneRefs } from './office';

interface Playing {
  run: RunningAction;
  anim: ActionAnim;
  /** Mốc bắt đầu theo đồng hồ của trình duyệt. */
  localStart: number;
}

/**
 * Chạy hoạt ảnh theo lệnh từ server. Không tự quyết định thứ tự — server đã điều phối.
 * Bù lệch đồng hồ server/trình duyệt để overlay mở giữa chừng vẫn đúng tiến độ.
 */
export class Director {
  private playing = new Map<string, Playing>();
  private clockOffset = 0;

  constructor(private scene: SceneRefs) {}

  /** offset = giờ server - giờ trình duyệt. */
  syncClock(serverTime: number): void {
    this.clockOffset = serverTime - Date.now();
  }

  start(run: RunningAction): void {
    if (this.playing.has(run.runId)) return;
    const localStart = run.startedAt - this.clockOffset;
    if (Date.now() - localStart >= run.durationMs) return;
    this.playing.set(run.runId, { run, anim: createAnim(this.scene, run), localStart });
  }

  end(runId: string): void {
    const p = this.playing.get(runId);
    if (!p) return;
    p.anim.finish();
    this.playing.delete(runId);
  }

  /** Đồng bộ lại toàn bộ theo snapshot (khi vừa kết nối / kết nối lại). */
  reset(runs: RunningAction[]): void {
    for (const id of [...this.playing.keys()]) this.end(id);
    runs.forEach((r) => this.start(r));
  }

  setMood(m: Mood): void {
    this.scene.setMood(m);
  }

  tick(dtMs: number): void {
    const now = Date.now();
    for (const [id, p] of this.playing) {
      const elapsed = now - p.localStart;
      if (elapsed >= p.run.durationMs) {
        p.anim.update(p.run.durationMs);
        this.end(id);
      } else {
        p.anim.update(elapsed);
      }
    }
    this.scene.tick(dtMs);
  }
}
