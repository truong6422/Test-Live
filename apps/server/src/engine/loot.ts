import type { BigFish, LootItem } from '@cau/shared';

/** Nguồn ngẫu nhiên trong [0, 1) — tiêm vào để test xác định. */
export type Random = () => number;

export interface Catch {
  emoji: string;
  name: string;
  /** kg, 1 chữ số thập phân; 0 = rác. */
  kg: number;
}

export interface LootPick {
  item: LootItem;
  catch: Catch;
}

/** Một con cá từ mức này trở lên được tính là "cá to" (đếm vào `actionCounts['big_catch']`). */
export const BIG_CATCH_KG = 10;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.999999999) : 0);

/** Cân ngẫu nhiên đều trong [min, max] (đảo nếu ngược, kẹp ≥ 0), làm tròn 1 chữ số thập phân. */
export function rollKg(minKg: number, maxKg: number, random: Random): number {
  const lo = Math.max(0, Math.min(minKg, maxKg));
  const hi = Math.max(0, minKg, maxKg);
  return Math.round((lo + clamp01(random()) * (hi - lo)) * 10) / 10;
}

/** kg → gram (số nguyên, để lưu DB). */
export const kgToGrams = (kg: number): number => Math.max(0, Math.round(kg * 1000));
/** gram → kg, 1 chữ số thập phân. */
export const gramsToKg = (g: number): number => Math.round((g || 0) / 100) / 10;

/** Bốc một món theo trọng số. Danh sách rỗng / mọi trọng số ≤ 0 → null. */
export function pickLoot(loot: readonly LootItem[] | undefined, random: Random): LootPick | null {
  const items = (loot ?? []).filter((l) => Number.isFinite(l.weight) && l.weight > 0);
  if (items.length === 0) return null;
  const total = items.reduce((s, l) => s + l.weight, 0);
  let r = clamp01(random()) * total;
  let item = items[items.length - 1]!;
  for (const l of items) {
    r -= l.weight;
    if (r < 0) {
      item = l;
      break;
    }
  }
  return { item, catch: { emoji: item.emoji, name: item.name, kg: rollKg(item.minKg, item.maxKg, random) } };
}

/** Chốt cân một con cá to (ngẫu nhiên trong khoảng) — chỉ dùng cho sự kiện MIỄN PHÍ (cá to định kỳ, tập thể). */
export function rollBigFish(fish: BigFish, random: Random): Catch {
  return { emoji: fish.emoji, name: fish.name, kg: rollKg(fish.minKg, fish.maxKg, random) };
}

/**
 * Cân CỐ ĐỊNH của cá to khi có quà = giữa khoảng [minKg, maxKg] (làm tròn 0,1 kg).
 * Chính sách TikTok LIVE cấm "trò may rủi" gắn với quà: người tặng phải biết trước chắc chắn mình nhận gì,
 * nên kết quả của quà không được có yếu tố ngẫu nhiên (cả loài cá lẫn cân nặng).
 */
export function fixedBigFish(fish: BigFish): Catch {
  return { emoji: fish.emoji, name: fish.name, kg: rollKg(fish.minKg, fish.maxKg, () => 0.5) };
}

/** Định dạng cân kiểu Việt: 1.5 → "1,5". */
export const formatKg = (kg: number): string => String(kg).replace('.', ',');

/** Điền "{name}" / "{kg}" trong câu nói. Rác (kg = 0) thì bỏ phần cân cho tự nhiên. */
export function fillCatchText(template: string, c: Catch): string {
  let out = template;
  if (c.kg > 0) out = out.replaceAll('{kg}', formatKg(c.kg));
  else out = out.replace(/\s*\{kg\}\s*kg\b/gi, '').replaceAll('{kg}', '');
  return out.replaceAll('{name}', c.name).replace(/\s{2,}/g, ' ').trim();
}
