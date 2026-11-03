import type { KingConfig, KingEffect, KingState, Mood } from '@cau/shared';

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Tâm trạng Cá Thần theo độ bình thản:
 * ≥80 Lững lờ · ≥60 Tò mò · ≥35 Cáu kỉnh · ≥15 Quẫy dữ dội · còn lại (hoặc đang hết sức) Kiệt sức.
 */
export function moodFor(calm: number, exhausted: boolean): Mood {
  if (exhausted) return 'exhausted';
  if (calm >= 80) return 'calm';
  if (calm >= 60) return 'curious';
  if (calm >= 35) return 'agitated';
  if (calm >= 15) return 'thrashing';
  return 'exhausted';
}

export function initialKing(): KingState {
  return { calm: 100, stamina: 100, mood: 'calm', exhaustedUntil: 0, lastActionId: null, lastActorName: null };
}

/** Áp tác động của một hành động lên Cá Thần. Cạn sức bền → kiệt sức (nổi bụng lên mặt nước) trong exhaustedMs. */
export function applyEffect(
  state: KingState,
  effect: KingEffect,
  cfg: KingConfig,
  now: number,
  meta: { actionId: string; actorName: string | null }
): KingState {
  const calm = clamp(state.calm + effect.calm);
  const stamina = clamp(state.stamina + effect.stamina);
  let exhaustedUntil = state.exhaustedUntil;
  if (stamina <= 0 && state.stamina > 0) exhaustedUntil = now + cfg.exhaustedMs;
  const exhausted = exhaustedUntil > now;
  return {
    calm,
    stamina,
    exhaustedUntil,
    mood: moodFor(calm, exhausted),
    lastActionId: meta.actionId,
    lastActorName: meta.actorName
  };
}

/** Hồi phục theo thời gian. Trong lúc kiệt sức thì không hồi. */
export function recover(state: KingState, cfg: KingConfig, dtMs: number, now: number): KingState {
  const exhausted = state.exhaustedUntil > now;
  if (exhausted) {
    const mood = moodFor(state.calm, true);
    return mood === state.mood ? state : { ...state, mood };
  }
  const dt = Math.max(0, dtMs) / 1000;
  const calm = clamp(state.calm + cfg.calmRecoveryPerSec * dt);
  const stamina = clamp(state.stamina + cfg.staminaRecoveryPerSec * dt);
  return { ...state, calm, stamina, exhaustedUntil: 0, mood: moodFor(calm, false) };
}

export function setCalm(state: KingState, calm: number, now: number): KingState {
  const c = clamp(calm);
  return { ...state, calm: c, mood: moodFor(c, state.exhaustedUntil > now) };
}

/** So sánh để quyết định có cần phát cập nhật ra overlay (bỏ dao động lẻ). */
export function kingChangedMeaningfully(a: KingState, b: KingState): boolean {
  return (
    a.mood !== b.mood ||
    Math.round(a.calm) !== Math.round(b.calm) ||
    Math.round(a.stamina) !== Math.round(b.stamina) ||
    a.lastActionId !== b.lastActionId
  );
}
