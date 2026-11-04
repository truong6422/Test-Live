import type { BigFish, GameConfig } from '@cau/shared';

/**
 * Cân cá to khi kéo bằng QUÀ: luôn CỐ ĐỊNH = điểm giữa [minKg, maxKg], làm tròn 0,1 kg.
 * Kết quả có trả phí không được may rủi (chính sách TikTok cấm trò chơi may rủi) — server tính giống hệt.
 */
export function giftKg(fish: Pick<BigFish, 'minKg' | 'maxKg'>): number {
  return Math.round(((fish.minKg + fish.maxKg) / 2) * 10) / 10;
}

/** Số kg kiểu Việt Nam (dấu phẩy thập phân, tối đa 1 chữ số). */
export const fmtKgVi = (kg: number) => (Math.round(kg * 10) / 10).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/**
 * Hành động có chạy ở chế độ MIỄN PHÍ ngẫu nhiên không: cá to định kỳ (`fishing.bigFishActionId`)
 * hoặc sự kiện tập thể (`collective.actionId`). Hai chế độ này vẫn bốc cân ngẫu nhiên trong khoảng.
 */
export function randomUses(actionId: string, config: GameConfig): string[] {
  const out: string[] = [];
  if (config.fishing.bigFishActionId === actionId) out.push('cá to định kỳ');
  if (config.collective.actionId === actionId) out.push('sự kiện tập thể');
  return out;
}

/** Câu nhắc ngắn vì sao quà cho cân cố định. */
export const FIXED_GIFT_HINT = 'Kết quả có quà luôn cố định để tuân thủ TikTok (không may rủi khi có quà).';
