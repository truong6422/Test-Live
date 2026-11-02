import type { BossConfig, BossEffect, BossState, Mood } from '@sep/shared';

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function moodFor(calm: number, exhausted: boolean): Mood {
  if (exhausted) return 'helpless';
  if (calm >= 80) return 'normal';
  if (calm >= 60) return 'annoyed';
  if (calm >= 35) return 'angry';
  if (calm >= 15) return 'panic';
  return 'helpless';
}

export function initialBoss(): BossState {
  return { calm: 100, stamina: 100, mood: 'normal', exhaustedUntil: 0, lastActionId: null, lastActorName: null };
}

/** Áp hiệu ứng của một hành động lên Sếp. Cạn sức chịu đựng -> bất lực trong exhaustedMs. */
export function applyEffect(
  state: BossState,
  effect: BossEffect,
  cfg: BossConfig,
  now: number,
  meta: { actionId: string; actorName: string | null }
): BossState {
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

/** Hồi phục theo thời gian. Trong lúc bất lực thì không hồi. */
export function recover(state: BossState, cfg: BossConfig, dtMs: number, now: number): BossState {
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

export function setCalm(state: BossState, calm: number, now: number): BossState {
  const c = clamp(calm);
  return { ...state, calm: c, mood: moodFor(c, state.exhaustedUntil > now) };
}

/** So sánh để quyết định có cần phát cập nhật ra overlay (bỏ dao động lẻ). */
export function bossChangedMeaningfully(a: BossState, b: BossState): boolean {
  return (
    a.mood !== b.mood ||
    Math.round(a.calm) !== Math.round(b.calm) ||
    Math.round(a.stamina) !== Math.round(b.stamina) ||
    a.lastActionId !== b.lastActionId
  );
}
