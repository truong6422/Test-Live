import type { Container, Graphics, Text } from 'pixi.js';
import type { CatchEvent, ChatEvent, Mood, RosterMember, RunningAction, WorkEvent } from '@cau/shared';

/**
 * HỢP ĐỒNG giữa phần dựng cảnh hồ câu (lake.ts, angler.ts, king.ts) và phần hoạt ảnh (animations.ts, director.ts).
 * Phần cảnh PHẢI cài đặt đúng các kiểu dưới đây; phần hoạt ảnh CHỈ dùng những gì khai báo ở đây.
 * Đổi file này = đổi cả hai phía.
 *
 * Toạ độ sân khấu 1080×1920 (dọc). Gốc (0,0) góc trên trái.
 */

/** Các điểm mốc cố định trên sân khấu (lake.ts export const LAKE_SPOTS: LakeSpots). */
export interface LakeSpots {
  /** Mép trên mặt nước (y) — trên là trời/bờ xa, dưới là nước. */
  waterTopY: number;
  /** Mép dưới mặt nước (y) — dưới là bờ gần + các bến. */
  waterBottomY: number;
  /** Chỗ Cá Thần nằm khi rảnh (giữa hồ). */
  kingHome: { x: number; y: number };
  /** Mép bờ gần nơi cần thủ đứng ném/quăng (đứng ở đây là chạm nước). */
  shoreY: number;
  /** Bến thuyền nhỏ (thuyền nan neo ở đây) — dùng cho drum_boat. */
  boatDock: { x: number; y: number };
  /** Cống xả lũ trên bờ xa — dùng cho open_floodgate. */
  floodgate: { x: number; y: number };
}

/**
 * Khu ngồi: 'front' = Bến Vàng trước mặt hồ (top quà / câu lâu, to và nổi bật), 'left' | 'right' = hai bên bờ.
 * Server quyết định qua RosterMember.seat. lake.ts export const SHIRTS: number[] (bảng màu áo, chọn theo hash ID).
 * (DOCKS / DockInfo cũ đã bỏ.)
 */
export type SeatSide = 'front' | 'left' | 'right';

/** Thẻ cần thủ. lake.ts export const TAG. */
export const TAG_TEXT = { official: 'CẦN THỦ', rookie: 'TẬP SỰ' } as const;

/** Chỗ ngồi câu của một người. */
export interface Spot {
  index: number;
  side: SeatSide;
  /** Màu áo của người ngồi. */
  shirt: number;
  /** Vị trí chân người ngồi (giữa đáy). */
  x: number;
  y: number;
  /** Tỉ lệ thu nhỏ theo mức bố cục. */
  s: number;
  member: RosterMember | null;
  /** Nhân vật đang ngồi tại chỗ — ẩn khi người này đi vắng (đang diễn hành động). */
  person: Container;
  /** Điểm đầu cần câu (thế giới), nơi dây câu thả xuống. */
  rodTip: { x: number; y: number };
}

/** Quản lý toàn bộ chỗ ngồi quanh hồ. */
export interface Anglers {
  sync(roster: RosterMember[]): void;
  /** Biểu cảm vui tại chỗ khi bình luận khớp "việc" (thay mồi, trà đá, hát...). */
  emote(e: WorkEvent): void;
  /** Bình luận thường → bong bóng chat trên đầu người câu đó. */
  chat(e: ChatEvent): void;
  /**
   * Chu kỳ câu tự động (mỗi 5s server gửi một lô): mỗi cần thủ giật cần, cá nhỏ bay lên + "x.xkg",
   * lệch pha ngẫu nhiên trong ~4s cho đỡ đồng loạt. Rác (kg = 0) thì nhân vật nhăn mặt.
   */
  catches(events: CatchEvent[]): void;
  spotOf(displayName: string | undefined): Spot | undefined;
  /** Làm nổi bảng tên của một người (người vừa tặng quà): phóng to + nhấp nháy vàng. null = tắt. */
  spotlight(spot: Spot | null): void;
  occupied(): Spot[];
  /** Ẩn/hiện nhân vật ngồi tại chỗ (khi chủ chỗ đi diễn hành động). */
  setAway(spot: Spot, away: boolean): void;
  /** Ẩn/hiện cần câu thường của người ngồi (khi hoạt ảnh vẽ cần cong kéo cá to ngay tại ghế — khỏi hai cần). */
  setRodHidden(spot: Spot, hidden: boolean): void;
  /** Cả hồ cùng phản ứng (vd. "cheer" khi kéo Cá Thần, "wet" khi lũ, "scared" khi sấm). */
  reactAll(kind: 'cheer' | 'wet' | 'scared' | 'pull' | null): void;
  /** Mọi cần thủ cùng kéo; k 0..1 = độ nghiêng người về sau. */
  pullAll(k: number): void;
}

export type WalkerPose = 'idle' | 'walk' | 'throw' | 'cheer' | 'scared' | 'pull' | 'swim' | 'row';

/** Nhân vật người xem đi lại khi diễn hành động (angler.ts export class Walker). */
export interface WalkerLike extends Container {
  setPerson(name: string, opts: { shirt: number; official: boolean; seed: string }): void;
  pose: WalkerPose;
  /** Hướng mặt: 1 phải, -1 trái. */
  facing: 1 | -1;
  /** Hiện đồ cầm tay. */
  holding: 'none' | 'bait' | 'ground_bait' | 'lure' | 'net' | 'drum' | 'scissors' | 'goggles';
}

/** Cá Thần (king.ts export class King). Gốc (0,0) = tâm thân cá. */
export interface KingLike extends Container {
  setMood(m: Mood): void;
  /** Biểu cảm tạm thời do hoạt ảnh đặt; null = theo mood. */
  setExpression(e: 'hit' | 'shock' | 'dizzy' | 'happy' | 'chomp' | null): void;
  /** 0 = chìm dưới nước (chỉ thấy lưng + vây), 1 = nhô hẳn lên (thấy đầu, râu). */
  rise: number;
  /** Độ lắc / quẫy (0..1). */
  thrash: number;
  /** Góc xoay (radian) — dùng khi bị xoáy nước cuốn. */
  spin: number;
  /** Độ dài râu 0..1 (dive_bottom tỉa râu → giảm, hồi phục trong finish()). */
  whisker: number;
  /** Ngửa bụng nổi lên (kiệt sức). */
  bellyUp: boolean;
}

/** Cảnh cắt đáy hồ (dive_bottom). Chỉ vẽ khi visible. */
export interface Underwater {
  root: Container;
  /** Cá Thần phiên bản dưới đáy (to hơn). */
  king: KingLike;
  /** Thợ lặn (người tặng quà). */
  diver: WalkerLike;
  fx: Container;
}

export interface Weather {
  /** 0..1 độ tối mây giông phủ cả cảnh. */
  setStorm(k: number): void;
  /** Bật/tắt mưa rơi. */
  setRain(on: boolean): void;
  /** Chớp sáng toàn màn hình (gọi mỗi khi muốn 1 tia chớp). */
  flash(): void;
}

export interface SceneRefs {
  root: Container;
  /** Lớp hiệu ứng nổi trên mọi thứ của cảnh hồ (bong bóng, giọt nước, chữ). */
  fx: Container;
  /** Lớp hiệu ứng nằm TRÊN mặt nước nhưng DƯỚI cần thủ (gợn sóng, đàn cá nhỏ, chài). */
  waterFx: Container;
  king: KingLike;
  anglers: Anglers;
  /** Tạo nhân vật đi lại cho một hành động; nhớ removeWalker trong finish(). */
  spawnWalker(): WalkerLike;
  removeWalker(w: WalkerLike): void;
  /** Rung cả sân khấu (0..1) cho cảnh kéo cá to; về 0 trong finish(). */
  setShake(k: number): void;
  /**
   * Camera của cảnh hồ (không ảnh hưởng HUD HTML, băng rôn, đáy hồ).
   * focus(owner, x, y, zoom, screenY?): lia mượt để điểm (x, y) của thế giới hiện ở (540, screenY) với độ zoom; gọi mỗi khung được.
   * release(owner): về toàn cảnh — chỉ tác dụng nếu owner đang giữ camera (quà mới hơn giành camera).
   */
  camera: {
    focus(owner: string, x: number, y: number, zoom: number, screenY?: number): void;
    release(owner: string): void;
    /** Toạ độ thế giới → toạ độ màn hình (sau zoom). */
    toScreen(x: number, y: number): { x: number; y: number };
  };
  /** Lớp hiệu ứng KHÔNG bị zoom (toạ độ màn hình): chữ to, tia sáng, pháo hoa — không bị phóng to tràn mép. */
  screenFx: Container;
  /** Thuyền nan (trang trí; có thể dùng trong hoạt ảnh). root đặt ở boatDock khi rảnh. */
  boat: { root: Container; rock: number };
  /** Cống xả: setOpen(0..1) mở cửa cống; mực nước tăng setFlood(0..1). */
  floodgate: { setOpen(k: number): void; setFlood(k: number): void };
  weather: Weather;
  /** Bóng cá to lượn dưới mặt hồ trước khi cá to định kỳ xuất hiện (main.ts bật/tắt theo nextBigFishAt). */
  bigFishShadow: { show(on: boolean): void };
  underwater: Underwater;
  /** Màn đen chuyển cảnh + băng rôn tên cảnh. */
  fade: Graphics;
  banner: Container;
  bannerText: Text;
  setMood(m: Mood): void;
  tick(dtMs: number): void;
}

/** Bảng cân cá + top quà là HTML trong hud.ts (không thuộc cảnh). RunningAction.fish chứa cá to + kg cho hoạt ảnh kéo cá. */
export type BigFishRun = RunningAction & { fish: NonNullable<RunningAction['fish']> };

/** lake.ts export function buildLake(): SceneRefs */
export type BuildLake = () => SceneRefs;
