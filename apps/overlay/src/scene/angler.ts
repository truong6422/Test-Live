import { BitmapFontManager, BitmapText, Container, Graphics, GraphicsContext, Sprite, Text, Texture } from 'pixi.js';
import { ROSTER_MAX, type CatchEvent, type ChatEvent, type RosterMember, type WorkEvent } from '@cau/shared';
import { anglerTexture, smallFishTexture } from './assets';
import { TAG_TEXT, type Anglers, type SeatSide, type Spot, type WalkerLike, type WalkerPose } from './contract';
import { block, drawGrid, hash, INK, pixelPanel, type Palette } from './pixel';
import { clamp01, easeInOut, easeOut, lerp } from './util';

/*
 * Cần thủ quanh hồ:
 *   - hai bên bờ (trái / phải): ngồi nghiêng nhìn ra hồ, xếp cột dọc theo mép nước, cần câu chĩa ra mặt hồ
 *   - Bến Vàng (bờ xa, ngay dưới HUD trên): ngồi nhìn thẳng về phía người xem, to hơn, có sàn tre + hào quang,
 *     cần câu chĩa xuống mặt hồ trước mặt
 * Mọi hình vẽ pixel bằng Graphics; thân người dùng chung GraphicsContext theo ngoại hình (nhẹ máy).
 */

// ---------------------------------------------------------------------------
// Hình học hồ (lake.ts vẽ bờ theo đúng các hằng số này)
// ---------------------------------------------------------------------------
// Mặc định = hình học của cảnh vẽ tay. Có ảnh nền public/bg/lake.png thì lake.ts gọi useImageGeometry()
// (trước khi dựng cảnh) để đổi sang số đo trên ảnh. Các object dưới đây được sửa tại chỗ, không thay mới.
export const WATER = { top: 716, bottom: 1460 };
/** Khoảng dọc của hai bờ bên nơi cần thủ ngồi. */
export const BANK = { top: 748, bottom: 1448 };
/** Bến Vàng trên bờ xa (ngay dưới HUD trên): sàn tre + chân người ngồi. lake.ts vẽ sàn theo các mốc này. */
export const FRONT = { x0: 300, x1: 780, deckTop: 628, deckBottom: 716, feetY: 686, max: 6, min: 5, scale: 0 };
/** Bố cục bờ bên: bờ xiên (vẽ tay) hay thẳng đứng (ảnh nền); shrink = hồ đang thu hẹp bao nhiêu px mỗi bên. */
const LAYOUT = { slanted: true, left: 132, right: 948, shrink: 0 };

/**
 * Số đo trên ảnh nền 1080×1920 (public/bg/lake.png):
 *   mặt nước x 132–946, y 722–1620 (bờ thẳng đứng, góc bo tròn);
 *   lối đất bờ trái x 32–92, cỏ 92–132; bờ phải cỏ 948–990, lối đất 990–1050; y ≈ 780–1540;
 *   sàn tre VIP x 352–725, mặt sàn y 642, mép trước y 758 (chân cọc tới ~780); chiếu đỏ x 418–664, y 657–720.
 */
export function useImageGeometry(): void {
  Object.assign(WATER, { top: 722, bottom: 1620 });
  // cả dải bờ thấy được trên điện thoại: từ bờ xa (dưới HUD trên) tới trên khung bình luận TikTok (y ≈ 1540)
  Object.assign(BANK, { top: 668, bottom: 1536 });
  // VIP to gấp ~1.6–1.8 lần người ngồi bờ: 5 ghế cách nhau ~75px trải hết sàn, chân trên sàn y≈735,
  // thân người nhô lên trên nền bờ xa (mong muốn); cần câu chĩa xuống nước ngay dưới mép sàn (y≈758).
  Object.assign(FRONT, { x0: 332, x1: 747, deckTop: 642, deckBottom: 758, feetY: 735, scale: 1.6 });
  Object.assign(LAYOUT, { slanted: false, left: 132, right: 948 });
}

/** Mép nước GỐC (theo cảnh vẽ tay / ảnh nền, chưa tính hồ thu hẹp). */
function baseEdge(side: 'left' | 'right', y: number): number {
  if (!LAYOUT.slanted) return side === 'left' ? LAYOUT.left : LAYOUT.right;
  const k = clamp01((y - WATER.top) / (WATER.bottom - WATER.top));
  const xl = lerp(196, 236, k);
  return side === 'left' ? xl : 1080 - xl;
}

/**
 * Mép nước hiện tại của bờ trái / phải tại độ cao y (vẽ tay: bờ hơi xiên cho có chiều sâu; ảnh nền: thẳng đứng).
 * Khi hồ đông, AnglerField thu hẹp hồ (LAYOUT.shrink) để hai bờ rộng ra, đủ chỗ cho 3 cột ghế.
 */
export function bankEdge(side: 'left' | 'right', y: number): number {
  const e = baseEdge(side, y);
  return side === 'left' ? e + LAYOUT.shrink : e - LAYOUT.shrink;
}

/** Bảng màu áo (chọn theo hash ID người xem). */
export const SHIRTS: number[] = [0x3584e4, 0xe66100, 0x26a269, 0x9141ac, 0xc01c28, 0x1c9aa8, 0xd4a017, 0x5e5c64];

/** Thẻ cần thủ: đã follow → CẦN THỦ (đội nón lá); chưa → TẬP SỰ. */
export const TAG = {
  official: { text: TAG_TEXT.official, color: 0xe5a50a },
  rookie: { text: TAG_TEXT.rookie, color: 0x77767b }
} as const;

/** Trộn bit để ID gần giống nhau vẫn ra ngoại hình khác nhau. */
export function mix(h: number): number {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 16;
  x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 16;
  return x >>> 0;
}

export const shirtFor = (id: string): number => SHIRTS[mix(hash(id)) % SHIRTS.length]!;

// ---------------------------------------------------------------------------
// Ngoại hình
// ---------------------------------------------------------------------------
const HAIR = [0x2b1d16, 0x4a2f1f, 0x1b1b24, 0x7a4a2a, 0x9c5a2a];
const SKIN = [0xf6c9a0, 0xeab58b, 0xd69e70];
const STRAW = 0xe9d48c;
const STRAW_DARK = 0xc9a55a;

export interface Look {
  hair: number;
  skin: number;
  shirt: number;
  /** Đội nón lá (cần thủ chính thức). */
  hat: boolean;
  long: boolean;
}

export function lookOf(seed: string, shirt: number, official: boolean): Look {
  const h = mix(hash(seed));
  return { hair: HAIR[h % HAIR.length]!, skin: SKIN[(h >>> 5) % SKIN.length]!, shirt, hat: official, long: (h >>> 9) % 3 === 0 };
}

function shade(c: number, k = 0.72): number {
  const r = Math.round(((c >> 16) & 255) * k);
  const g = Math.round(((c >> 8) & 255) * k);
  const b = Math.round((c & 255) * k);
  return (r << 16) | (g << 8) | b;
}

const palette = (l: Look): Palette => ({
  K: INK,
  H: l.hair,
  S: l.skin,
  E: INK,
  M: 0xb03a3a,
  C: l.shirt,
  c: shade(l.shirt),
  P: 0x2d3142,
  O: 0x111111,
  W: 0x8a5a3b
});

// Ngồi nghiêng (nhìn sang phải). 12×17 ô, mỗi ô 4 đơn vị → 48×68. Gốc = giữa mép dưới.
const SIDE_PX = 4;
const SIDE = [
  '...KKKKK....',
  '..KHHHHHK...',
  '.KHHHHHHHK..',
  '.KHHHHSSSK..',
  '.KHHHSSSEK..',
  '.KHHSSSSSSK.',
  '..KHSSSSMK..',
  '...KKSSSKK..',
  '..KCCCCCCK..',
  '.KCCCCCCCSSK',
  '.KCCcCCCCKK.',
  '.KCCcCCCCK..',
  '.KPPPPPPPPPK',
  '.KPPPPPPPPPK',
  '..KWWK..KPPK',
  '..KWWK..KPPK',
  '.KKKKKK.KOOK'
];
const SIDE_H = SIDE.length * SIDE_PX; // 68
/** Tay cầm cần (đơn vị, nhìn sang phải). */
const SIDE_HAND = { x: 16, y: -30 } as const;

// Ngồi nhìn thẳng về phía người xem (Bến Vàng bờ xa), chân thả trước mép chiếu. 12×17 ô → 48×68.
const FACE = [
  '...KKKKKK...',
  '..KHHHHHHK..',
  '.KHHHHHHHHK.',
  '.KHSSSSSSHK.',
  '.KSSSSSSSSK.',
  '.KSESSSSESK.',
  '.KSSSSSSSSK.',
  '..KSSMMSSK..',
  '...KKKKKK...',
  '..KCCCCCCK..',
  '.KCCCCCCCCK.',
  'KCCCcCCCCCSK',
  'KSCCcCCCCCKK',
  '.KPPPPPPPPK.',
  '.KPPKKKKPPK.',
  '.KPPK..KPPK.',
  '.KOOK..KOOK.'
];
const FACE_H = FACE.length * SIDE_PX; // 68
/** Tay cầm cần (bên phải người ngồi, nhìn từ phía người xem). */
const FACE_HAND = { x: 18, y: -22 } as const;

type View = 'side' | 'face';
const ctxCache = new Map<string, GraphicsContext>();

/** Thân người ngồi — dùng chung theo (kiểu nhìn, ngoại hình). */
function personCtx(view: View, l: Look): GraphicsContext {
  const key = `${view}|${l.hair}|${l.skin}|${l.shirt}|${l.hat ? 1 : 0}|${l.long ? 1 : 0}`;
  let ctx = ctxCache.get(key);
  if (ctx) return ctx;
  ctx = new GraphicsContext();
  const pal = palette(l);
  if (view === 'side') {
    if (l.long) ctx.rect(-22, -50, 10, 22).fill(INK).rect(-20, -50, 6, 18).fill(l.hair);
    drawGrid(ctx, SIDE, pal, SIDE_PX, -24, -SIDE_H);
    if (l.hat) {
      ctx.poly([-2, -86, -36, -58, 32, -58]).fill(INK);
      ctx.poly([-2, -81, -30, -61, 26, -61]).fill(STRAW);
      ctx.rect(-20, -66, 38, 3).fill(STRAW_DARK).rect(-10, -74, 18, 2).fill(STRAW_DARK);
    }
  } else {
    if (l.long) ctx.rect(-26, -58, 52, 26).fill(INK).rect(-24, -58, 48, 24).fill(l.hair);
    drawGrid(ctx, FACE, pal, SIDE_PX, -24, -FACE_H);
    if (l.hat) {
      ctx.poly([0, -88, -36, -58, 36, -58]).fill(INK);
      ctx.poly([0, -83, -30, -61, 30, -61]).fill(STRAW);
      ctx.rect(-22, -66, 44, 3).fill(STRAW_DARK).rect(-12, -75, 24, 2).fill(STRAW_DARK);
    }
  }
  ctxCache.set(key, ctx);
  return ctx;
}

let _stoolSide: GraphicsContext | null = null;
let _stoolFace: GraphicsContext | null = null;
let _grimSide: GraphicsContext | null = null;
let _grimFace: GraphicsContext | null = null;
let _glow: GraphicsContext | null = null;

const stoolSide = () =>
  (_stoolSide ??= block(new GraphicsContext(), -12, -16, 24, 6, 0x8a5a3b, INK, 2).rect(-10, -10, 4, 10).fill(INK).rect(6, -10, 4, 10).fill(INK));
/** Ghế đẩu gỗ Bến Vàng (cùng tông gỗ ghế trong ảnh cần thủ + sàn tre — không còn đệm đỏ lẫn với chiếu đỏ cũ). */
const stoolFace = () =>
  (_stoolFace ??= block(new GraphicsContext(), -16, -16, 32, 6, 0x8a5a3b, INK, 2)
    .rect(-14, -16, 28, 2)
    .fill(0xb07a4a)
    .rect(-13, -10, 5, 10)
    .fill(INK)
    .rect(8, -10, 5, 10)
    .fill(INK)
    .rect(-12, -10, 3, 9)
    .fill(0x6b4a2a)
    .rect(9, -10, 3, 9)
    .fill(0x6b4a2a));
/** Nhăn mặt (rác): mắt nhắm tịt, miệng méo, giọt mồ hôi. */
const grimSide = () =>
  (_grimSide ??= new GraphicsContext()
    .rect(4, -53, 10, 3)
    .fill(INK)
    .rect(3, -44, 3, 2)
    .fill(INK)
    .rect(6, -42, 3, 2)
    .fill(INK)
    .rect(9, -44, 3, 2)
    .fill(INK)
    .rect(-8, -66, 5, 8)
    .fill(0x62a0ea)
    .rect(-7, -70, 3, 4)
    .fill(0x62a0ea));
const grimFace = () =>
  (_grimFace ??= new GraphicsContext()
    .rect(-18, -48, 10, 3)
    .fill(INK)
    .rect(4, -48, 10, 3)
    .fill(INK)
    .rect(-6, -40, 3, 2)
    .fill(INK)
    .rect(-3, -38, 3, 2)
    .fill(INK)
    .rect(0, -40, 3, 2)
    .fill(INK)
    .rect(3, -38, 3, 2)
    .fill(INK)
    .rect(22, -70, 5, 8)
    .fill(0x62a0ea)
    .rect(23, -74, 3, 4)
    .fill(0x62a0ea));
/** Hào quang vàng sau lưng người ngồi Bến Vàng. */
const glowCtx = () =>
  (_glow ??= new GraphicsContext()
    .rect(-34, -78, 68, 84)
    .fill({ color: 0xffd166, alpha: 0.16 })
    .rect(-28, -86, 56, 96)
    .fill({ color: 0xffd166, alpha: 0.16 })
    .rect(-22, -92, 44, 104)
    .fill({ color: 0xfff1b8, alpha: 0.18 }));

// Một kiểu chữ bitmap dùng chung (tạo atlas động một lần), tô màu bằng tint.
// Atlas chữ bitmap vẽ ở độ phân giải 2: camera zoom ×1.6–1.9 vào người tặng quà mà bảng tên vẫn sắc nét.
BitmapFontManager.defaultOptions.resolution = 2;
const BMP_STYLE = { fontFamily: 'Segoe UI, Arial', fontSize: 24, fontWeight: '900' as const, fill: 0xffffff };
const bmp = (text = '') => {
  const t = new BitmapText({ text, style: BMP_STYLE });
  t.anchor.set(0.5);
  return t;
};
const short = (s: string, n: number) => [...s.trim()].slice(0, n).join('');

const graphemes = (() => {
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('vi', { granularity: 'grapheme' }) : null;
  return (s: string): string[] => (seg ? Array.from(seg.segment(s), (g) => g.segment) : [...s]);
})();

/** Tên hơi dài được co chữ tới mức này trước khi phải cắt "…". */
const FIT_MIN_SCALE = 0.82;

/**
 * Đặt chữ vào BitmapText ở cỡ `k`, vừa bề rộng maxW đo được (không theo số ký tự): hơi dài thì co chữ (≥ 82%),
 * dài hơn nữa thì cắt và thêm "…". Cắt theo cụm ký tự (emoji ghép, dấu tổ hợp) để không sinh ký tự lỗi.
 * Chỉ chạy khi bảng tên đổi.
 */
function fitText(t: BitmapText, text: string, k: number, maxW: number): void {
  t.scale.set(k);
  const full = text.trim();
  t.text = full;
  if (t.width <= maxW) return;
  if (t.width * FIT_MIN_SCALE <= maxW) {
    t.scale.set((k * maxW) / t.width);
    return;
  }
  t.scale.set(k * FIT_MIN_SCALE);
  const g = graphemes(full);
  let lo = 0;
  let hi = g.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    t.text = `${g.slice(0, mid).join('').trimEnd()}…`;
    if (t.width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  t.text = `${g.slice(0, Math.max(1, lo)).join('').trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Chỗ ngồi
// ---------------------------------------------------------------------------
interface Seat extends Spot {
  root: Container;
  view: View;
  /** 1 = nhìn sang phải, -1 = nhìn sang trái. */
  dir: 1 | -1;
  col: number;
  body: Graphics;
  /** Ảnh cần thủ (anglers.png) — có ảnh thì thay cho body vẽ pixel. */
  sprite: Sprite;
  rodWrap: Container;
  bobber: Graphics;
  bobberY: number;
  grimace: Graphics;
  stool: Graphics;
  /** Bảng tên (lớp nhãn riêng phía trên mọi người ngồi, toạ độ thế giới, cỡ chữ không phụ thuộc scale ghế). */
  label: Container;
  labelBg: Graphics;
  plate: BitmapText;
  kgText: BitmapText | null;
  /** Lệch dọc của bảng tên (Bến Vàng so le hai tầng để bảng rộng hơn khoảng cách ghế). */
  labelDy: number;
  /** Bảng tên được phóng to tối đa bao nhiêu (nảy khi vào hồ / đang được zoom) mà không lấn sang ô bảng bên cạnh. */
  labelMaxScale: number;
  /** Bờ bên: khoảng ngang [lo, hi] dành cho bảng tên + mép dưới ô (bảng kể cả lúc nảy không ra khỏi đây). */
  slotLo: number;
  slotHi: number;
  slotBottom: number;
  /** Hàng (bờ bên, 0 = trên cùng). */
  row: number;
  labelKey: string;
  /** Lúc vừa vào hồ (bảng tên nảy + sáng lên vài giây). */
  joinAt: number;
  glow: Graphics | null;
  lookKey: string;
  away: boolean;
  jerkAt: number;
  dipAt: number;
  trashUntil: number;
  emoteUntil: number;
}

/**
 * Mức bố cục mỗi bên bờ. Người là trọng tâm: mỗi ghế là một Ô riêng = người ngồi + bảng tên NGAY DƯỚI ghế đẩu;
 * các hàng thẳng hàng (không so le) và ô không chồng lên nhau → bảng tên không bao giờ che người nào.
 * Nhiều cột → THU HẸP HỒ (dựng cầu ván gỗ, shrink tự tính đủ chỗ cho các cột) thay vì thu nhỏ người.
 *   colDx: khoảng cách tâm hai cột (= bề ngang tối đa của bảng tên); maxS: cỡ người tối đa; font: cỡ chữ bảng tên.
 * Cỡ người thật = min(maxS, chỗ dọc của một ô) — xem build().
 */
const SIDE_TIERS = [
  { cols: 1, rows: 4, colDx: 0, maxS: 2.0, font: 24 }, // ≤ 4 người mỗi bên: một cột, người thật to, hồ rộng
  { cols: 2, rows: 4, colDx: 128, maxS: 2.0, font: 22 }, // ≤ 8 người mỗi bên
  { cols: 2, rows: 5, colDx: 120, maxS: 1.6, font: 22 }, // ≤ 10 người mỗi bên (≈ 25 người cả hồ)
  { cols: 3, rows: 5, colDx: 104, maxS: 1.6, font: 21 }, // ≤ 15 người mỗi bên
  { cols: 3, rows: 6, colDx: 104, maxS: 1.25, font: 20 }, // ≤ 18 người mỗi bên
  { cols: 4, rows: 6, colDx: 80, maxS: 1.25, font: 19 } // tới 24 người mỗi bên (≈ 50 người cả hồ)
] as const;
/** Khoảng tâm người ngồi cột trong lùi vào bờ so với mép nước (đơn vị ảnh, × scale): tay + cần vươn ra mặt nước. */
const SIDE_INSET = 26;
/** Nửa bề ngang ảnh người ngồi nghiêng (đơn vị ảnh). */
const SIDE_HALF_W = 28;
/** Màu cầu ván gỗ khi hồ thu hẹp (cùng tông ván Bến Vàng trong lake.ts). */
const WOOD = { plank: [0xc6944d, 0xbd8a45, 0xcf9c55], hi: 0xd9b277, seam: 0x604226, nail: 0x3a2818, beam: 0x8a612d, post: 0x6b4a2a, ink: 0x1b140e };
/** Bảng tên bờ bên: cao = cỡ chữ + PLATE_PAD (khung + vạch thẻ). Khe giữa các phần trong một ô ghế. */
const PLATE_PAD = 11;
const CELL_GAP = { head: 4, plate: 2, bottom: 6 };
// stagger ≥ chiều cao bảng có dòng kg (55px) × độ phóng tối đa, để bảng hàng trên (kể cả lúc nảy) không đè bảng hàng dưới
const FRONT_LABEL = { font: 23, kgFont: 19, stagger: 64 };
const JOIN_MS = 3200;
/** Mép trên thấp nhất của bong bóng thoại: HUD HTML (kể cả dải DEMO/tạm dừng + bảng cân) kết thúc ở y ≤ 560. */
const BUBBLE_MIN_TOP = 570;
/** Mép dưới thấp nhất của chữ trong cảnh (trên khung bình luận TikTok). */
const SAFE_BOTTOM = 1536;
const EMPTY_STOOL_ALPHA = 0.55;
/** Chiều cao ảnh cần thủ (đơn vị trước scale, gồm cả ghế đẩu). */
const SPRITE_H = 84;
/** Nắm tay trên ảnh cần thủ (đơn vị, gốc = giữa mép dưới ảnh; đo trên anglers.png: ≈ +0.43 rộng, −0.6 cao). */
const SPRITE_SIDE_HAND = { x: 24, y: -50 } as const;
const SPRITE_FACE_HAND = { x: 25, y: -49 } as const;

/** Có ảnh cần thủ → kéo cá tại chỗ dùng luôn người ngồi; trả về tay cầm cần + đỉnh đầu (toạ độ sân khấu). */
export function seatedPullPoints(spot: Spot): { hand: { x: number; y: number }; headY: number } | null {
  const front = spot.side === 'front';
  if (!anglerTexture(front ? 'face' : 'side', 0)) return null;
  const h = front ? SPRITE_FACE_HAND : SPRITE_SIDE_HAND;
  const dir = spot.side === 'right' ? -1 : 1;
  return { hand: { x: spot.x + dir * h.x * spot.s, y: spot.y + h.y * spot.s }, headY: spot.y - SPRITE_H * spot.s };
}
const MAX_FLY = 36;
const MAX_EMOTES = 14;
/** Bình luận dài hơn thì cắt "…" (bong bóng tối đa ~2 dòng). */
const CHAT_MAX = 40;
const LINE_SIDE = 34;
const LINE_FACE = 30;
/** Phao chìm bao lâu trước khi giật cần. */
const DIP_MS = 420;

interface Fly {
  node: Container;
  fish: Text;
  /** Ảnh cá thường (small-fish.png) — có thì dùng thay emoji. */
  spr: Sprite;
  kg: BitmapText;
  label: BitmapText;
  splash: Graphics;
  t0: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  big: boolean;
  active: boolean;
}

export class AnglerField implements Anglers {
  private seats: Seat[] = [];
  private tier = -1;
  private nFront = 0;
  /** Bề ngang tối đa bảng tên Bến Vàng (px thế giới). */
  /** Khoảng cách hai ghế Bến Vàng cạnh nhau (bảng tên so le hai tầng → cùng tầng cách nhau gấp đôi). */
  private frontSpacing = 75;
  /** Lớp bảng tên: luôn nằm trên mọi ghế để người hàng dưới không che tên người hàng trên. */
  private labels = new Container();
  /** ID đã thấy trong hồ (để chào người mới vào); null = chưa nhận roster lần nào. */
  private known: Set<string> | null = null;
  private byId = new Map<string, Seat>();
  private byName = new Map<string, Seat>();
  private t = 0;
  private react: 'cheer' | 'wet' | 'scared' | 'pull' | null = null;
  private pull = 0;
  private lit: Seat | null = null;
  /** Cá chờ lên (theo platformId — ghế có thể bị dựng lại khi đổi mức bố cục trước lúc đến hẹn). */
  private pending: { e: CatchEvent; at: number }[] = [];
  private flies: Fly[] = [];
  private emotes: { node: Container; until: number; born: number; seat: Seat }[] = [];
  /** Bờ cỏ lấn ra mặt hồ khi hồ thu hẹp (dưới cùng lớp ghế). */
  private shore = new Graphics();

  constructor(
    readonly layer: Container,
    readonly fxLayer: Container
  ) {
    this.layer.addChild(this.shore);
    this.build(0, FRONT.min);
  }

  /**
   * Hồ đông: dựng CẦU VÁN GỖ dọc hai bờ, lấn vào hồ `shrink` px (0 = không có). Ván cùng tông với Bến Vàng:
   * ván ngang so le, đầu ván + đinh, dầm viền mép nước, cọc chống thò xuống nước và bóng đổ trên mặt nước.
   */
  private drawShore(shrink: number): void {
    const g = this.shore.clear();
    if (shrink <= 0) return;
    const top = WATER.top - 2;
    const bot = WATER.bottom + 2;
    const PH = 16; // bề dày một tấm ván
    for (const side of ['left', 'right'] as const) {
      const d = side === 'left' ? 1 : -1;
      for (let y = top, i = 0; y < bot; y += PH, i++) {
        const e0 = baseEdge(side, y);
        const e1 = e0 + d * shrink;
        const x0 = side === 'left' ? e0 - 10 : e1;
        const w = shrink + 10;
        const h = Math.min(PH, bot - y);
        // bóng cầu đổ xuống nước
        g.rect(side === 'left' ? e1 : e1 - 18, y, 18, h).fill({ color: 0x000000, alpha: 0.28 });
        // tấm ván
        g.rect(x0, y, w, h).fill(WOOD.plank[i % 3]!);
        g.rect(x0, y, w, 2).fill({ color: WOOD.hi, alpha: 0.55 });
        g.rect(x0, y + h - 2, w, 2).fill(WOOD.seam);
        // đầu ván so le + 2 đinh
        const off = (hash(`pl${side}${i}`) % 70) + 20;
        for (let jx = x0 + off; jx < x0 + w - 12; jx += 96) {
          g.rect(jx, y + 1, 2, h - 2).fill(WOOD.seam);
          g.rect(jx - 6, y + 5, 3, 3).fill(WOOD.nail).rect(jx + 5, y + 5, 3, 3).fill(WOOD.nail);
        }
      }
      // dầm viền mép nước + nét mực, cọc chống mỗi ~120px
      for (let y = top; y < bot; y += 8) {
        const e1 = baseEdge(side, y) + d * shrink;
        const h = Math.min(8, bot - y);
        g.rect(side === 'left' ? e1 - 12 : e1, y, 12, h).fill(WOOD.beam);
        g.rect(side === 'left' ? e1 - 3 : e1, y, 3, h).fill(WOOD.ink);
      }
      for (let y = top + 40; y < bot - 20; y += 120) {
        const e1 = baseEdge(side, y) + d * shrink;
        const px = side === 'left' ? e1 - 2 : e1 - 12;
        g.rect(px, y, 14, 30).fill(WOOD.post).stroke({ width: 2, color: WOOD.ink });
        // gợn nước quanh chân cọc
        g.rect(px - 6 * d + (d > 0 ? 14 : -10), y + 24, 10, 3).fill({ color: 0xffffff, alpha: 0.35 });
      }
    }
  }


  // ----- Hợp đồng Anglers -----

  sync(roster: RosterMember[]): void {
    const members = roster.slice(0, ROSTER_MAX);
    const front = members.filter((m) => m.seat === 'front');
    const nLeft = members.filter((m) => m.seat === 'left').length;
    const nRight = members.filter((m) => m.seat === 'right').length;
    const nFront = Math.max(FRONT.min, Math.min(FRONT.max, front.length));
    const overflow = Math.max(0, front.length - nFront);
    const need = Math.max(nLeft, nRight, Math.ceil((nLeft + nRight + overflow) / 2));
    let tier = SIDE_TIERS.findIndex((t) => t.cols * t.rows >= need);
    if (tier < 0) tier = SIDE_TIERS.length - 1;
    // Không co/giãn qua lại liên tục: chỉ về mức nhỏ hơn khi dư ít nhất 3 chỗ.
    if (tier < this.tier) {
      const lower = SIDE_TIERS[tier]!;
      if (lower.cols * lower.rows - need < 3) tier = this.tier;
    }
    if (tier !== this.tier || nFront !== this.nFront) this.build(tier, nFront);

    // Bến Vàng xếp theo hạng: kim cương trong phiên, hoà thì câu lâu hơn. this.seats bắt đầu bằng các ghế chiếu
    // theo thứ tự giữa → phải → trái → phải → trái, nên hạng i ngồi ghế chiếu thứ i (#1 chính giữa).
    const frontSeats = this.seats.filter((s) => s.side === 'front');
    const vip = [...front]
      .sort((a, b) => (b.diamonds ?? 0) - (a.diamonds ?? 0) || (b.fishingMs ?? 0) - (a.fishingMs ?? 0) || a.platformId.localeCompare(b.platformId))
      .slice(0, frontSeats.length);
    const vipRank = new Map(vip.map((m, i) => [m.platformId, i] as const));

    const keep = new Map(members.map((m) => [m.platformId, m] as const));
    for (const s of this.seats) {
      if (!s.member) continue;
      const id = s.member.platformId;
      const m = keep.get(id);
      // rời hồ, server đổi khu ngồi, hoặc đổi hạng Bến Vàng → nhả chỗ để xếp lại
      if (!m) this.vacate(s);
      else if (s.side === 'front') {
        if (vipRank.get(id) !== frontSeats.indexOf(s)) this.vacate(s);
      } else if (m.seat === 'front' ? vipRank.has(id) : m.seat !== s.side) this.vacate(s);
    }
    vip.forEach((m, i) => this.occupy(frontSeats[i]!, m));
    // bề rộng bảng tên Bến Vàng tuỳ ghế cùng tầng bên cạnh có người hay không → vẽ lại khi đã xếp đủ (bảng không đổi thì bỏ qua)
    for (const s of frontSeats) if (s.member) this.drawLabel(s, s.member);
    for (const m of members) {
      if (vipRank.has(m.platformId)) continue;
      const s = this.byId.get(m.platformId);
      if (s) {
        this.occupy(s, m);
        continue;
      }
      const free =
        this.firstFree(m.seat) ??
        (m.seat === 'front' ? this.firstFree(hash(m.platformId) % 2 ? 'left' : 'right') : undefined) ??
        this.firstFree(m.seat === 'left' ? 'right' : 'left') ??
        this.firstFree(m.seat === 'right' ? 'left' : 'right');
      if (free) this.occupy(free, m);
    }
    this.greet(members);
  }

  /** Người mới vào hồ: bong bóng "vào câu" có tên + bảng tên nảy sáng (lần nhận roster đầu tiên thì không chào). */
  private greet(members: RosterMember[]): void {
    const ids = new Set(members.map((m) => m.platformId));
    if (this.known) {
      let shown = 0;
      const now = performance.now();
      for (const m of members) {
        if (this.known.has(m.platformId)) continue;
        const seat = this.byId.get(m.platformId);
        if (!seat) continue;
        seat.joinAt = now;
        // nhiều người vào cùng lúc: chỉ gắn nhãn vài người, còn lại vẫn có bảng tên nảy sáng.
        // Nhãn HỆ THỐNG (không phải lời người xem) — không đặt chữ vào miệng người thật.
        if (shown++ < 4) this.bubble(seat, '🎣 vào hồ', JOIN_MS, true, 'system');
      }
    }
    this.known = ids;
  }

  emote(e: WorkEvent, ms = 2600): void {
    const seat = this.byId.get(e.platformId) ?? this.spotOf(e.displayName);
    if (seat) this.bubble(seat, `${e.emoji} ${[...e.text].length > 40 ? `${short(e.text, 39)}…` : e.text}`, ms, true, 'system');
  }

  chat(e: ChatEvent, ms = 4500): void {
    const seat = this.byId.get(e.platformId) ?? this.spotOf(e.displayName);
    if (!seat || seat.away) return;
    const text = [...e.text].length > CHAT_MAX ? `${short(e.text, CHAT_MAX - 1)}…` : e.text;
    this.bubble(seat, text, ms, false, 'say', e.displayName);
  }

  /**
   * Chữ trên đầu một cần thủ (mỗi người một cái — cái mới thay cái cũ). Hai kiểu tách bạch:
   *  - `say`: bong bóng thoại trắng có đuôi + dòng tên — CHỈ dùng cho bình luận thật người xem đã gõ;
   *  - `system`: nhãn hệ thống của trò chơi (vào hồ, việc vui…) — thẻ gỗ tối chữ vàng, không đuôi, không tên,
   *    để không ai tưởng đó là lời người xem nói.
   * Khung vẽ pixel (góc khuyết bậc thang, viền mực 3px) cùng kiểu ảnh nền. Không đủ chỗ phía trên đầu (Bến Vàng
   * sát HUD trên) thì đặt xuống dưới bảng tên, đuôi chỉ lên.
   */
  private bubble(seat: Seat, text: string, ms: number, bounce: boolean, kind: 'say' | 'system', name?: string): void {
    const now = performance.now();
    if (bounce) seat.emoteUntil = now + ms;
    // Bến Vàng: ghế sát nhau (~75px) → mỗi lúc chỉ một chữ của Bến Vàng, cái mới thay cái cũ (khỏi chồng lên nhau)
    const lone = seat.view === 'face';
    for (let i = this.emotes.length - 1; i >= 0; i--) {
      const other = this.emotes[i]!.seat;
      if (other !== seat && !(lone && other.view === 'face')) continue;
      this.emotes[i]!.node.destroy({ children: true });
      this.emotes.splice(i, 1);
    }
    while (this.emotes.length >= MAX_EMOTES) this.emotes.shift()!.node.destroy({ children: true });
    const node = new Container();
    const say = kind === 'say';
    const t = new Text({
      text,
      resolution: 2,
      style: say
        ? { fontFamily: 'Segoe UI, Arial', fontSize: 26, fontWeight: '800', fill: INK, wordWrap: true, wordWrapWidth: 300, align: 'center', lineHeight: 34 }
        : { fontFamily: 'Segoe UI, Arial', fontSize: 21, fontWeight: '800', fill: 0xffe2a0, wordWrap: true, wordWrapWidth: 260, align: 'center', lineHeight: 28 }
    });
    t.anchor.set(0.5, 0);
    const who =
      say && name
        ? new Text({ text: short(name, 16), resolution: 2, style: { fontFamily: 'Segoe UI, Arial', fontSize: 22, fontWeight: '900', fill: 0xb4471c, padding: 6 } })
        : null;
    if (who) who.anchor.set(0.5, 0);
    const nameH = who ? Math.ceil(who.height) - 4 : 0;
    const padX = say ? 26 : 20;
    const padY = say ? 14 : 8;
    const w = Math.ceil((Math.max(t.width, who?.width ?? 0) + padX) / 2) * 2;
    const h = Math.ceil((t.height + nameH + padY) / 2) * 2;
    t.y = -h / 2 + padY / 2 + nameH;
    if (who) who.y = -h / 2 + 4;
    const bg = new Graphics();
    const head = this.headTop(seat);
    const front = seat.view === 'face';
    // Bờ bên: bong bóng nằm TRÊN MẶT NƯỚC ngang đầu người nói, đuôi chĩa ngang về phía họ — các ghế xếp sát nhau
    // nên đặt trên đầu sẽ che người hàng trên. Bến Vàng: trên đầu; không đủ chỗ (sát HUD) thì dưới hàng bảng tên.
    let cx: number;
    let cy: number;
    let tail: 'down' | 'up' | 'left' | 'right';
    let tailX = 0;
    if (!front && seat.row === 0 && head.y - h - 14 >= BUBBLE_MIN_TOP) {
      // hàng trên cùng: phía trên đầu chỉ có bờ xa (dưới HUD) → đặt trên đầu, né sang ngoài để không che người Bến Vàng
      cy = head.y - 14 - h / 2;
      cx = seat.dir === 1 ? Math.min(head.x, FRONT.x0 - 8 - w / 2) : Math.max(head.x, FRONT.x1 + 8 + w / 2);
      tail = 'down';
      tailX = Math.max(-w / 2 + 14, Math.min(w / 2 - 14, head.x - Math.max(w / 2 + 6, Math.min(1074 - w / 2, cx))));
    } else if (!front) {
      const edge = bankEdge(seat.side === 'right' ? 'right' : 'left', seat.y);
      const other = bankEdge(seat.side === 'right' ? 'left' : 'right', seat.y);
      cx = seat.dir === 1 ? Math.min(edge + 14 + w / 2, other - 8 - w / 2) : Math.max(edge - 14 - w / 2, other + 8 + w / 2);
      // hàng trên cùng ngang Bến Vàng: không đè lên người ngồi trên sàn → hạ xuống dưới chân họ
      const overPier = cx + w / 2 > FRONT.x0 - 30 && cx - w / 2 < FRONT.x1 + 30;
      const minTop = overPier ? Math.max(BUBBLE_MIN_TOP, FRONT.feetY + 8) : BUBBLE_MIN_TOP;
      cy = Math.max(minTop + h / 2, Math.min(SAFE_BOTTOM - h / 2, head.y + 20 * seat.s + h / 2 - 22));
      tail = seat.dir === 1 ? 'left' : 'right';
    } else {
      // Bến Vàng: phía trên đầu là biển BẾN VÀNG + HUD → luôn đặt bong bóng dưới hàng bảng tên (trên mặt nước)
      const aboveTop = head.y - h - 14;
      const below = true;
      cy = below ? seat.y + 4 * seat.s + FRONT_LABEL.stagger + 64 + h / 2 : aboveTop + h / 2;
      // dưới bảng tên = trên mặt nước: không lấn sang người ngồi hai bờ khi hồ thu hẹp
      const lo = below ? bankEdge('left', cy) + 8 : 6;
      const hi = below ? bankEdge('right', cy) - 8 : 1074;
      cx = Math.max(lo + w / 2, Math.min(hi - w / 2, head.x));
      tail = below ? 'up' : 'down';
    }
    cx = Math.max(w / 2 + 6, Math.min(1080 - w / 2 - 6, cx));
    if (say) {
      pixelPanel(bg, -w / 2, -h / 2, w, h, 0xffffff, INK, 3, 6);
      // đuôi bậc thang chỉ về phía người nói (hàng 0 trùng viền khung — mở viền cho đuôi, các hàng sau nhô ra ngoài)
      if (tail === 'left' || tail === 'right') {
        // ngang tầm mặt người nói
        const ty = Math.max(-h / 2 + 10, Math.min(h / 2 - 22, head.y + 26 * seat.s - cy));
        for (let i = 0; i < 4; i++) {
          const hh = 18 - i * 5;
          const xx = tail === 'left' ? -w / 2 - i * 3 : w / 2 - 3 + i * 3;
          bg.rect(xx, ty, 3, hh).fill(INK);
          if (hh > 6) bg.rect(xx, ty + 3, 3, hh - 6).fill(0xffffff);
        }
      } else
        for (let i = 0; i < 4; i++) {
          const ww = 18 - i * 5;
          const yy = tail === 'up' ? -h / 2 - 3 - i * 3 : h / 2 + i * 3;
          bg.rect(tailX - ww / 2, yy, ww, 3).fill(INK);
          if (ww > 6) bg.rect(tailX - (ww - 6) / 2, yy, ww - 6, 3).fill(0xffffff);
        }
    } else {
      pixelPanel(bg, -w / 2, -h / 2, w, h, 0x3a2a1c, INK, 3, 3);
      bg.rect(-w / 2 + 3, -h / 2, w - 6, 2).fill(0x6b4a2a);
    }
    node.addChild(bg, t);
    if (who) node.addChild(who);
    node.position.set(Math.round(cx), Math.round(cy));
    this.fxLayer.addChild(node);
    this.emotes.push({ node, until: now + ms, born: now, seat });
  }

  catches(events: CatchEvent[]): void {
    const now = performance.now();
    for (const e of events) {
      if (!this.seatFor(e)) continue;
      // thường mỗi chu kỳ chỉ 1 con (theo thứ tự vào hồ) → hiện ngay; lô nhiều con thì lệch pha cho đỡ đồng loạt
      const delay = events.length <= 1 ? 0 : Math.random() * Math.min(4000, events.length * 300);
      this.pending.push({ e, at: now + delay });
    }
    if (this.pending.length > 400) this.pending.splice(0, this.pending.length - 400);
  }

  private seatFor(e: { platformId: string; displayName: string }): Seat | undefined {
    return this.byId.get(e.platformId) ?? this.spotOf(e.displayName);
  }

  spotOf(displayName: string | undefined): Seat | undefined {
    return displayName ? this.byName.get(displayName.trim()) : undefined;
  }

  spotlight(spot: Spot | null): void {
    const lit = (spot as Seat | null) ?? null;
    if (lit === this.lit) return;
    this.lit = lit;
    // bảng tên người tặng lên trên cùng (bảng hàng trên/cột ngoài không đè lên)
    if (lit && !lit.label.destroyed) this.labels.addChild(lit.label);
    // đang zoom vào người tặng: làm mờ bảng tên người khác (hàng sát nhau che mất đầu người tặng)
    for (const s of this.seats) s.label.alpha = lit && s !== lit ? 0.3 : 1;
  }

  occupied(): Seat[] {
    return this.seats.filter((s) => s.member);
  }

  setAway(spot: Spot, away: boolean): void {
    const s = spot as Seat;
    s.away = away;
    s.person.visible = !!s.member && !away;
    s.stool.visible = !s.person.visible;
  }

  setRodHidden(spot: Spot, hidden: boolean): void {
    const s = spot as Seat;
    if (!s.rodWrap.destroyed) s.rodWrap.visible = !hidden;
  }

  reactAll(kind:'cheer' | 'wet' | 'scared' | 'pull' | null): void {
    if (kind === this.react) return;
    this.react = kind;
    const tint = kind === 'wet' ? 0x9cc4ff : 0xffffff;
    for (const s of this.seats) {
      s.person.tint = tint;
      if (kind === null) {
        s.person.x = 0;
        s.person.y = 0;
      }
    }
  }

  pullAll(k: number): void {
    this.pull = clamp01(k);
  }

  // ----- Vòng lặp -----

  tick(dtMs: number): void {
    this.t += dtMs;
    const now = performance.now();

    // cá đến hẹn → giật cần + cá bay lên
    // (vòng lặp tại chỗ, không tạo mảng mới mỗi khung)
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (p.at > now) continue;
      this.pending.splice(i, 1);
      const seat = this.seatFor(p.e);
      if (seat) this.land(seat, p.e, now);
    }

    for (const f of this.flies) if (f.active) this.tickFly(f, now);

    for (let i = this.emotes.length - 1; i >= 0; i--) {
      const e = this.emotes[i]!;
      if (e.until <= now) {
        e.node.destroy({ children: true });
        this.emotes.splice(i, 1);
        continue;
      }
      // đang zoom vào người tặng quà: ẩn bong bóng của người khác cho khỏi che
      e.node.visible = !this.lit || e.seat === this.lit;
      e.node.alpha = Math.min(1, (e.until - now) / 400);
      e.node.pivot.y = Math.min(now - e.born, 600) * 0.03;
    }

    const t = this.t;
    const pull = this.pull;
    for (const s of this.seats) {
      // người mới vào: bảng tên nảy to rồi về cỡ thường, viền sáng vàng
      const nk = (now - s.joinAt) / JOIN_MS;
      if (s === this.lit) {
        // người vừa tặng quà: bảng tên to + nhịp vàng
        s.label.scale.set(Math.min(s.labelMaxScale, 1.25 + 0.08 * Math.sin(t * 0.012)));
        s.labelBg.tint = Math.sin(t * 0.012) > 0 ? 0xffd166 : 0xfff0a0;
      } else if (nk >= 0 && nk < 1) {
        s.label.scale.set(Math.min(s.labelMaxScale, 1 + 0.35 * Math.max(0, Math.sin(Math.min(1, nk * 3) * Math.PI)) + 0.12 * (1 - nk)));
        s.labelBg.tint = nk < 0.8 ? 0xfff0a0 : 0xffffff;
      } else if (s.label.scale.x !== 1) {
        s.label.scale.set(1);
        s.labelBg.tint = 0xffffff;
      }
      if (!s.member || !s.person.visible) {
        if (s.glow) s.glow.alpha = 0;
        continue;
      }
      // phao nhấp nhô
      s.bobber.y = s.bobberY + Math.round(Math.sin(t * 0.004 + s.index * 1.7) * 1.5) / s.s;
      // phao chìm xuống (cá cắn) rồi giật cần
      const dk = (now - s.dipAt) / DIP_MS;
      if (dk >= 0 && dk < 1) s.bobber.y += (Math.abs(Math.sin(dk * Math.PI * 3)) * 7 + dk * 4) / s.s;
      let rot = 0;
      const jk = (now - s.jerkAt) / 700;
      if (jk >= 0 && jk < 1) {
        rot = -0.38 * Math.sin(Math.PI * jk);
        s.bobber.y -= (Math.sin(Math.PI * jk) * 22) / s.s;
      }
      s.rodWrap.rotation = rot - pull * 0.35;
      const trash = s.trashUntil > now;
      // nét nhăn mặt chỉ khớp người vẽ pixel; dùng ảnh thì chỉ rung người
      const grim = trash && !s.sprite.visible;
      if (s.grimace.visible !== grim) s.grimace.visible = grim;

      let px = 0;
      let py = 0;
      if (this.react === 'cheer') py = -Math.abs(Math.sin(t * 0.018 + s.index)) * 9;
      else if (this.react === 'scared') px = Math.sin(t * 0.09 + s.index) * 2;
      if (trash) px += Math.sin(t * 0.08) * 1.5;
      if (s.emoteUntil > now) py += Math.floor(t / 90) % 2 ? -3 : 0;
      if (jk >= 0 && jk < 1) py -= Math.sin(Math.PI * jk) * 3;
      // kéo: nghiêng người về phía sau (xa mặt nước)
      if (s.view === 'side') s.person.rotation = -pull * 0.28;
      else {
        s.person.scale.y = 1 - pull * 0.1;
        py += pull * 5;
      }
      s.person.x = px * s.dir;
      s.person.y = py;
      if (s.glow) s.glow.alpha = 0.75 + Math.sin(t * 0.004 + s.index) * 0.25;
    }
  }

  // ----- Nội bộ -----

  private headTop(s: Seat): { x: number; y: number } {
    const h = s.sprite.visible ? SPRITE_H : s.view === 'side' ? 74 : 72;
    return s.view === 'side' ? { x: s.x + s.dir * 2 * s.s, y: s.y - h * s.s } : { x: s.x, y: s.y - h * s.s };
  }

  private firstFree(side: SeatSide): Seat | undefined {
    return this.seats.find((x) => !x.member && x.side === side);
  }

  /** Một con cá lên: giật cần, cá bay từ phao lên đầu kèm số cân. */
  private land(s: Seat, e: CatchEvent, now: number): void {
    if (!s.member || s.member.platformId !== e.platformId) return;
    s.dipAt = now;
    s.jerkAt = now + DIP_MS;
    if (e.kg <= 0) s.trashUntil = now + DIP_MS + 1400;
    if (s.away || !s.person.visible) return;
    const f = this.flies.find((x) => !x.active) ?? this.newFly();
    if (!f) return;
    const head = this.headTop(s);
    f.fx = s.rodTip.x;
    f.fy = s.rodTip.y + (s.view === 'side' ? LINE_SIDE : LINE_FACE);
    if (s.view === 'side') {
      // bờ bên: cá bay lên mặt nước ngay cạnh đầu người câu (bay lên trên đầu sẽ che người hàng trên)
      f.tx = bankEdge(s.side === 'right' ? 'right' : 'left', s.y) + s.dir * 64;
      const overPier = f.tx > FRONT.x0 - 50 && f.tx < FRONT.x1 + 50;
      // ngang Bến Vàng: hạ xuống dưới cả hai tầng bảng tên Bến Vàng (không đè tên người khác)
      f.ty = Math.max(overPier ? FRONT.feetY + FRONT_LABEL.stagger + 110 : BUBBLE_MIN_TOP + 44, head.y + 30);
    } else {
      // Bến Vàng: trên đầu là biển BẾN VÀNG → cá + số cân bay ra mặt nước dưới hàng bảng tên
      const ty = s.y + 4 * s.s + FRONT_LABEL.stagger + 90;
      f.tx = Math.max(bankEdge('left', ty) + 50, Math.min(bankEdge('right', ty) - 50, head.x));
      f.ty = ty;
    }
    f.t0 = now + DIP_MS;
    f.big = e.kg >= 10;
    f.active = true;
    f.fish.text = e.emoji;
    const tex = smallFishTexture(e.name, e.emoji);
    f.spr.visible = !!tex;
    f.fish.visible = !tex;
    if (tex) {
      f.spr.texture = tex;
      // dài ≈56–72px theo cân nặng (ảnh quay đầu sang trái → lật để đầu hướng ra xa người câu)
      const len = 56 + 16 * Math.min(1, Math.max(0, e.kg) / 10);
      const k = len / Math.max(1, tex.width, tex.height * 1.4);
      f.spr.scale.set(k * (s.dir === 1 ? -1 : 1), k);
    }
    f.kg.text = e.kg > 0 ? `${e.kg.toFixed(1).replace('.', ',')}kg` : 'Ặc!';
    f.label.text = short(e.name, 16);
    f.splash.position.set(f.fx, f.fy);
    f.splash.scale.set(Math.max(0.7, Math.min(1.3, s.s)));
    f.kg.tint = e.kg <= 0 ? 0xff5a5a : f.big ? 0xffd166 : 0xffffff;
    const k = Math.max(0.75, Math.min(1.25, s.s)) * (f.big ? 1.35 : 1);
    f.node.scale.set(k);
    f.node.visible = false;
    f.node.alpha = 1;
    f.node.position.set(f.fx, f.fy);
  }

  private newFly(): Fly | undefined {
    if (this.flies.length >= MAX_FLY) return undefined;
    const node = new Container();
    const fish = new Text({ text: '🐟', style: { fontFamily: 'Segoe UI Emoji, Apple Color Emoji, sans-serif', fontSize: 30 } });
    fish.anchor.set(0.5);
    const spr = new Sprite(Texture.EMPTY);
    spr.anchor.set(0.5);
    spr.visible = false;
    const kg = bmp('');
    kg.scale.set(0.9);
    kg.y = 28;
    const label = bmp('');
    label.scale.set(0.75);
    label.y = -32;
    label.tint = 0xfff4d6;
    node.addChild(fish, spr, kg, label);
    node.visible = false;
    const splash = new Graphics();
    for (const [x, y, w, h] of [[-14, -6, 5, 8], [-6, -14, 4, 10], [2, -16, 4, 12], [10, -8, 5, 8], [-20, 2, 40, 4]] as const)
      splash.rect(x, y, w, h).fill({ color: 0xe6f6ff, alpha: 0.9 });
    splash.visible = false;
    this.fxLayer.addChild(splash, node);
    const f: Fly = { node, fish, spr, kg, label, splash, t0: 0, fx: 0, fy: 0, tx: 0, ty: 0, big: false, active: false };
    this.flies.push(f);
    return f;
  }

  private tickFly(f: Fly, now: number): void {
    const age = now - f.t0;
    const dur = f.big ? 2600 : 2000;
    if (age < 0) return;
    if (age >= dur) {
      f.active = false;
      f.node.visible = false;
      f.splash.visible = false;
      return;
    }
    f.node.visible = true;
    const sk = age / 450;
    f.splash.visible = sk < 1;
    if (sk < 1) {
      f.splash.scale.y = Math.abs(f.splash.scale.x) * (0.6 + sk);
      f.splash.alpha = 1 - sk;
    }
    if (age < 500) {
      const k = easeOut(age / 500);
      f.node.x = lerp(f.fx, f.tx, k);
      f.node.y = lerp(f.fy, f.ty, k) - Math.sin(Math.PI * k) * 46;
      f.fish.rotation = (1 - k) * 2.4;
      f.spr.rotation = (1 - k) * 2.4;
      f.kg.visible = false;
      f.label.visible = false;
    } else {
      f.label.visible = true;
      f.fish.rotation = Math.sin(age * 0.03) * 0.15;
      f.spr.rotation = Math.sin(age * 0.03) * 0.15;
      f.kg.visible = true;
      f.node.x = f.tx;
      f.node.y = f.ty - (age - 500) * 0.012;
      f.node.alpha = age > dur - 300 ? (dur - age) / 300 : 1;
    }
  }

  private build(tier: number, nFront: number): void {
    for (const s of this.seats) {
      // ghế cũ có thể còn bị giữ ở nơi khác (hoạt ảnh đang chạy, bong bóng) → nhả người ngồi để không bị coi là còn chỗ
      s.member = null;
      s.root.destroy({ children: true });
      s.label.destroy({ children: true });
    }
    if (this.lit && !this.lit.member) this.lit = null;
    this.seats = [];
    this.byId.clear();
    this.byName.clear();
    this.tier = tier;
    this.nFront = nFront;

    const { cols, rows, colDx, maxS, font } = SIDE_TIERS[tier]!;
    // Ô ghế: [khe][người SPRITE_H·s][khe][bảng tên][khe] — không ô nào chồng lên ô khác.
    const cellH = (BANK.bottom - BANK.top) / rows;
    const plateH = font + PLATE_PAD;
    const fixedH = CELL_GAP.head + CELL_GAP.plate + plateH + CELL_GAP.bottom;
    const s = Math.round(Math.min(maxS, (cellH - fixedH) / SPRITE_H) * 100) / 100;
    const contentH = SPRITE_H * s + fixedH;
    // nhiều cột → hồ thu hẹp đủ để cột ngoài cùng (kể cả bảng tên) vẫn nằm trong khung hình
    const inset = SIDE_INSET * s;
    const need = cols > 1 ? inset + (cols - 1) * colDx + colDx / 2 + 4 : inset + SIDE_HALF_W * s + 4;
    const shrink = Math.max(0, Math.ceil(need - Math.min(baseEdge('left', BANK.top), 1080 - baseEdge('right', BANK.top))));
    // hồ đông → thu hẹp mặt nước, dựng cầu ván gỗ (mọi chỗ dùng bankEdge tự theo)
    LAYOUT.shrink = shrink;
    this.drawShore(shrink);

    // Thứ tự gán chỗ: cột trong cùng (sát nước) trước, từ trên xuống. Thứ tự vẽ: hàng trên trước, cột ngoài trước.
    const side: { side: 'left' | 'right'; r: number; c: number; x: number; y: number; lo: number; hi: number; bottom: number }[] = [];
    for (const which of ['left', 'right'] as const)
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++) {
          const cellTop = BANK.top + cellH * r + (cellH - contentH) / 2;
          const y = Math.round(cellTop + CELL_GAP.head + SPRITE_H * s);
          const edge = bankEdge(which, y);
          const d = which === 'left' ? -1 : 1;
          const x = Math.round(edge + d * (inset + c * colDx));
          // ô bảng tên: nửa khoảng tới cột bên cạnh; cột ngoài cùng được rộng tới mép khung, một cột thì rộng thoải mái
          const near = cols > 1 ? colDx / 2 - 3 : 30 + inset;
          const toFrame = Math.abs(x - (which === 'left' ? 4 : 1076));
          const far = cols === 1 ? Math.min(toFrame, 120) : c < cols - 1 ? colDx / 2 - 3 : toFrame;
          const lo = Math.round(which === 'left' ? x - far : x - near);
          const hi = Math.round(which === 'left' ? x + near : x + far);
          side.push({ side: which, r, c, x, y, lo, hi, bottom: Math.floor(BANK.top + cellH * (r + 1)) });
        }
    const drawOrder = [...side].sort((a, b) => a.y - b.y || b.c - a.c);
    const seatOf = new Map<(typeof side)[number], Seat>();
    for (const d of drawOrder) {
      const seat = this.makeSeat(d.side, d.c, d.x, d.y, s);
      seat.slotLo = d.lo;
      seat.slotHi = d.hi;
      seat.slotBottom = d.bottom;
      seat.row = d.r;
      seatOf.set(d, seat);
    }
    // danh sách gán chỗ theo cột → hàng
    const ordered = side.map((d) => seatOf.get(d)!);

    // Bến Vàng
    const fronts: Seat[] = [];
    const spacing = Math.min(100, (FRONT.x1 - FRONT.x0 - 40) / nFront);
    // ảnh nền: cỡ VIP cố định (co lại chút nếu 6 ghế); vẽ tay: theo khoảng cách ghế như cũ
    const fs = FRONT.scale ? FRONT.scale * Math.min(1, spacing / 75) : Math.min(1.5, spacing / 62);
    for (let i = 0; i < nFront; i++) {
      const x = Math.round(540 + (i - (nFront - 1) / 2) * spacing);
      fronts.push(this.makeSeat('front', 0, x, FRONT.feetY, fs));
    }
    // gán chỗ Bến Vàng từ giữa ra hai bên (người đứng đầu ngồi chính giữa)
    // #1 chính giữa, #2 bên phải, #3 bên trái, #4 phải tiếp, #5 trái tiếp…
    const frontOrder = [...fronts].sort((a, b) => Math.abs(a.x - 540) - Math.abs(b.x - 540) || b.x - a.x);
    this.seats = [...frontOrder, ...ordered];
    this.seats.forEach((x, i) => (x.index = i));
    // bảng tên Bến Vàng so le hai tầng (theo thứ tự trái → phải) → mỗi bảng được rộng gần gấp đôi khoảng cách ghế
    this.frontSpacing = spacing;
    fronts.forEach((f, i) => (f.labelDy = i % 2 ? FRONT_LABEL.stagger : 0));
    // lớp bảng tên luôn ở trên cùng lớp ghế
    this.layer.addChild(this.labels);
  }

  private makeSeat(sideName: SeatSide, col: number, x: number, y: number, s: number): Seat {
    const view: View = sideName === 'front' ? 'face' : 'side';
    const dir: 1 | -1 = sideName === 'right' ? -1 : 1;
    const root = new Container();
    root.position.set(x, y);
    root.scale.set(s);

    const glow = view === 'face' ? new Graphics(glowCtx()) : null;
    if (glow) glow.alpha = 0;
    const stool = new Graphics(view === 'side' ? stoolSide() : stoolFace());
    stool.scale.x = dir;

    const person = new Container();
    person.visible = false;
    const body = new Graphics();
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5, 1);
    sprite.visible = false;
    const grimace = new Graphics(view === 'side' ? grimSide() : grimFace());
    grimace.visible = false;

    // Cần câu: xoay quanh tay cầm. Đầu cần luôn ở trên mặt nước, dây + phao thả xuống nước.
    const useSprite = !!anglerTexture(view, 0);
    const hand = useSprite ? (view === 'side' ? SPRITE_SIDE_HAND : SPRITE_FACE_HAND) : view === 'side' ? SIDE_HAND : FACE_HAND;
    const h = hash(`${sideName}:${col}:${x}:${y}`);
    let tipX: number;
    let tipY: number;
    if (view === 'side') {
      const edge = bankEdge(sideName === 'left' ? 'left' : 'right', y);
      tipX = edge + dir * (34 + (h % 5) * 18 + col * 14);
      tipY = y - 34 * s - 26 - col * 12 - ((h >> 3) % 3) * 10;
    } else {
      tipX = x + 22 + ((h >> 2) % 3) * 10;
      // cần chĩa xuống mặt nước phía trước mép sàn tre
      tipY = Math.max(WATER.top + 46, FRONT.deckBottom + 30) + ((h >> 4) % 3) * 16;
    }
    const rodWrap = new Container();
    rodWrap.position.set(hand.x, hand.y);
    // đầu cần trong hệ toạ độ của tay (đã tính lật trái/phải)
    const lx = ((tipX - x) / s) * dir - hand.x;
    const ly = (tipY - y) / s - hand.y;
    const lineLen = (view === 'side' ? LINE_SIDE : LINE_FACE) / s;
    const rod = new Graphics()
      .moveTo(0, 0)
      .lineTo(lx * 0.55, ly * 0.55)
      .stroke({ width: 3.2 / s, color: 0x5b3a1e })
      .moveTo(lx * 0.55, ly * 0.55)
      .lineTo(lx, ly)
      .stroke({ width: 2 / s, color: 0x8a6a3a })
      .moveTo(lx, ly)
      .lineTo(lx, ly + lineLen)
      .stroke({ width: 1 / s, color: 0xf2efe6, alpha: 0.75 });
    const bobber = new Graphics().rect(-3, -6, 6, 11).fill(INK).rect(-2, -5, 4, 4).fill(0xe01b24).rect(-2, -1, 4, 5).fill(0xffffff);
    bobber.scale.set(1 / s);
    const bobberY = ly + lineLen;
    bobber.position.set(lx, bobberY);
    rodWrap.addChild(rod, bobber);
    // nhìn nghiêng: cần sau thân (tay đưa ra trước); nhìn thẳng: cần chĩa về phía người xem, vẽ trước thân
    if (view === 'side') person.addChild(rodWrap, body, sprite, grimace);
    else person.addChild(body, sprite, grimace, rodWrap);
    person.scale.x = dir;

    // Bảng tên (dưới chân, lớp nhãn riêng, toạ độ thế giới — cỡ chữ cố định theo FRONT_LABEL / SIDE_LABEL)
    const front = view === 'face';
    const label = new Container();
    label.position.set(x, y + 4 * s);
    const labelBg = new Graphics();
    const plate = bmp('');
    plate.tint = INK;
    const kgText = front ? bmp('') : null;
    if (kgText) kgText.tint = 0xb4471c;
    label.addChild(labelBg, plate);
    if (kgText) label.addChild(kgText);
    // ghế trống: chỉ còn ghế đẩu mờ, không có bảng tên
    label.visible = false;
    this.labels.addChild(label);
    stool.alpha = EMPTY_STOOL_ALPHA;

    const kids: Container[] = [];
    if (glow) kids.push(glow);
    kids.push(stool, person);
    root.addChild(...kids);
    this.layer.addChild(root);

    return {
      index: 0,
      side: sideName,
      shirt: SHIRTS[0]!,
      x,
      y,
      s,
      member: null,
      person,
      rodTip: { x: Math.round(tipX), y: Math.round(tipY) },
      root,
      view,
      dir,
      col,
      body,
      sprite,
      rodWrap,
      bobber,
      bobberY,
      grimace,
      stool,
      label,
      labelBg,
      plate,
      kgText,
      labelDy: 0,
      labelMaxScale: 2,
      slotLo: 0,
      slotHi: 1080,
      slotBottom: 1920,
      row: 0,
      labelKey: '',
      joinAt: -1e9,
      glow,
      lookKey: '',
      away: false,
      jerkAt: -1e9,
      dipAt: -1e9,
      trashUntil: 0,
      emoteUntil: 0
    };
  }

  private occupy(seat: Seat, m: RosterMember): void {
    const prev = seat.member;
    seat.member = m;
    this.byId.set(m.platformId, seat);
    if (prev && prev.displayName !== m.displayName && this.byName.get(prev.displayName.trim()) === seat) this.byName.delete(prev.displayName.trim());
    this.byName.set(m.displayName.trim(), seat);
    this.drawLabel(seat, m);
    seat.shirt = shirtFor(m.platformId);
    const look = lookOf(m.platformId, seat.shirt, m.follower);
    const key = `${look.shirt}|${look.hat}|${m.displayName}`;
    if (key === seat.lookKey) return;
    seat.lookKey = key;
    // Bến Vàng chỉ có 3 ảnh nhìn thẳng → chia theo ghế để hai người cạnh nhau không trùng ảnh
    const tex = anglerTexture(seat.view, seat.view === 'face' ? seat.index : mix(hash(m.platformId)));
    if (tex) {
      // ảnh cao ≈ người vẽ pixel + nón (đơn vị trước scale), giữ tỉ lệ
      seat.sprite.texture = tex;
      seat.sprite.scale.set(SPRITE_H / tex.height);
      seat.sprite.visible = true;
      seat.body.visible = false;
    } else {
      seat.body.context = personCtx(seat.view, look);
      seat.body.visible = true;
      seat.sprite.visible = false;
    }
    seat.person.visible = !seat.away;
    seat.stool.visible = !seat.person.visible;
    seat.stool.alpha = 1;
  }

  /**
   * Vẽ bảng tên: nền giấy viền mực, vạch màu dưới cùng theo thẻ (vàng = CẦN THỦ đã follow, xám = TẬP SỰ),
   * Bến Vàng thêm dòng số kg. Chỉ vẽ lại khi tên / kg / thẻ đổi.
   */
  private drawLabel(seat: Seat, m: RosterMember): void {
    const front = seat.view === 'face';
    const spec = front ? FRONT_LABEL : SIDE_TIERS[Math.max(0, this.tier)]!;
    // Bến Vàng: chỉ hiện kg khi đã có cá (bỏ dòng "0,0kg" rườm rà)
    const kg = front && (m.kg ?? 0) > 0 ? `${(m.kg ?? 0).toFixed(1).replace('.', ',')}kg` : '';
    const slot = front ? this.frontSlot(seat) : 0;
    const key = `${m.displayName}|${kg}|${m.follower ? 1 : 0}|${this.tier}|${slot}`;
    seat.label.visible = true;
    if (key === seat.labelKey) return;
    seat.labelKey = key;

    const k = spec.font / BMP_STYLE.fontSize;
    // Bến Vàng: bảng hẹp hơn ô ~14px để còn chỗ nảy to khi vào hồ / được zoom mà không chạm bảng cùng tầng
    // Bờ bên: vừa ô bảng tên của ghế (nửa khoảng tới cột bên cạnh), chừa ~8% để nảy nhẹ
    const maxW = front ? Math.max(90, Math.min(190, slot - 14)) : Math.min(200, Math.floor((seat.slotHi - seat.slotLo) * 0.92));
    fitText(seat.plate, m.displayName, k, maxW - 14);
    const nameH = spec.font + 6;
    let w = Math.ceil(seat.plate.width) + 14;
    let h = nameH;
    if (seat.kgText) seat.kgText.visible = !!kg;
    if (seat.kgText && kg) {
      seat.kgText.text = kg;
      seat.kgText.scale.set(FRONT_LABEL.kgFont / BMP_STYLE.fontSize);
      w = Math.max(w, Math.ceil(seat.kgText.width) + 14);
      seat.kgText.position.set(0, nameH + FRONT_LABEL.kgFont / 2);
      h += FRONT_LABEL.kgFont + 2;
    }
    seat.plate.position.set(0, nameH / 2 + 1);
    const tag = m.follower ? TAG.official : TAG.rookie;
    // khung pixel góc khuyết (cùng nét mực 3px với bong bóng), vạch màu thẻ ở đáy
    w = Math.min(Math.ceil(w / 2) * 2, maxW);
    // phóng tối đa: không lấn sang ô bên cạnh, và cao không quá khoảng so le (khỏi đè bảng tầng dưới)
    pixelPanel(seat.labelBg.clear(), -w / 2, 0, w, h + 5, front ? 0xffe2a0 : 0xfff6e5, INK, 3, 3);
    seat.labelBg.rect(-w / 2 + 3, h, w - 6, 5).fill(tag.color).rect(-w / 2, h, w, 2).fill(tag.color);
    if (front) {
      // Bến Vàng: dưới chân (mặt sàn tre / nước), so le hai tầng
      seat.labelMaxScale = Math.max(1, Math.min(slot / w, (FRONT_LABEL.stagger - 1) / (h + 5)));
      const half = w / 2 + 6;
      seat.label.position.set(Math.max(half, Math.min(1080 - half, seat.x)), seat.y + 4 * seat.s + seat.labelDy);
      return;
    }
    // Bờ bên: ngay DƯỚI ghế đẩu, trong ô của ghế → không bao giờ đè lên người nào (kể cả người hàng dưới).
    // Tâm bảng theo người ngồi, đẩy vào trong ô nếu cần; phóng to (nảy / được zoom) quanh mép trên-giữa,
    // nên giới hạn theo khoảng còn lại tới mép ô hai bên và tới mép dưới ô.
    const cx = Math.max(seat.slotLo + w / 2, Math.min(seat.slotHi - w / 2, seat.x));
    const ly = seat.y + CELL_GAP.plate;
    const room = Math.min(cx - seat.slotLo, seat.slotHi - cx) * 2;
    seat.labelMaxScale = Math.max(1, Math.min(1.25, room / w, (seat.slotBottom - ly) / (h + 5)));
    seat.label.position.set(Math.round(cx), ly);
  }

  /**
   * Bề rộng ô dành cho bảng tên Bến Vàng: tới bảng gần nhất cùng tầng đang có người (chia đôi khoảng cách, chừa khe 6px).
   * Cùng tầng không ai → rộng rãi (tên đầy đủ hơn khi hồ vắng).
   */
  private frontSlot(seat: Seat): number {
    let d = Infinity;
    for (const o of this.seats)
      if (o !== seat && o.side === 'front' && o.member && o.labelDy === seat.labelDy) d = Math.min(d, Math.abs(o.x - seat.x));
    return Math.floor(Math.min(d, this.frontSpacing * 3) - 6);
  }

  private vacate(seat: Seat): void {
    if (seat.member) {
      const name = seat.member.displayName.trim();
      this.byId.delete(seat.member.platformId);
      if (this.byName.get(name) === seat) this.byName.delete(name);
    }
    seat.member = null;
    seat.lookKey = '';
    seat.away = false;
    seat.person.visible = false;
    seat.stool.visible = true;
    seat.label.visible = false;
    seat.labelKey = '';
    seat.joinAt = -1e9;
    seat.rodWrap.visible = true;
    seat.stool.alpha = EMPTY_STOOL_ALPHA;
  }
}

// ---------------------------------------------------------------------------
// Nhân vật đi lại (người tặng quà ra mép hồ diễn hành động)
// ---------------------------------------------------------------------------
const W_PX = 5;
const W_HEAD = [
  '....KKKKKK....',
  '...KHHHHHHK...',
  '..KHHHHHHHHK..',
  '..KHSSSSSSHK..',
  '..KSSSSSSSSK..',
  '..KSESSSSESK..',
  '..KSSSSSSSSK..',
  '...KSSMMSSK...',
  '....KKKKKK....'
];
const W_TORSO = [
  '...KKCCCCKK...',
  '..KCCCCCCCCK..',
  '..KCCCCCCCCK..',
  '..KCCcCCCCCK..',
  '..KCCcCCCCCK..',
  '..KCCCCCCCCK..',
  '..KPPPPPPPPK..',
  '..KKKKKKKKKK..'
];
const W_LEGS = [
  ['...KPPKKPPK...', '...KPPKKPPK...', '..KOOOKKOOOK..'],
  ['..KPPK..KPPK..', '..KPPK..KPPK..', '.KOOOK..KOOOK.']
] as const;

type Holding = WalkerLike['holding'];

/** Người đứng/đi vẽ pixel (nhìn thẳng), tay xoay theo tư thế, đồ cầm ở tay phải. Gốc = giữa mép dưới. */
export class Walker extends Container implements WalkerLike {
  private readonly k: number;
  private body = new Container();
  private upper = new Graphics();
  private legs = [new Graphics(), new Graphics()];
  private hat = new Graphics();
  private goggles = new Graphics();
  private armL = new Container();
  private armR = new Container();
  private armLG = new Graphics();
  private armRG = new Graphics();
  private items = new Map<Holding, Graphics>();
  private oar = new Graphics();
  private tagBg = new Graphics();
  private tag = new Text({ text: '', style: { fontFamily: 'Segoe UI, Arial', fontSize: 26, fontWeight: '900', fill: 0xffffff } });
  private _pose: WalkerPose = 'idle';
  private _facing: 1 | -1 = 1;
  private _holding: Holding = 'none';
  private official = false;
  private t = Math.random() * 1000;

  constructor(scale = 1.3) {
    super();
    this.k = scale;
    this.body.scale.set(scale);
    this.armL.position.set(-27, -52);
    this.armR.position.set(27, -52);
    this.armL.addChild(this.armLG);
    this.armR.addChild(this.armRG);
    this.buildItems();
    this.goggles.rect(-28, -77, 56, 5).fill(INK);
    block(this.goggles, -22, -80, 16, 11, 0x62a0ea, INK, 2);
    block(this.goggles, 6, -80, 16, 11, 0x62a0ea, INK, 2);
    this.goggles.rect(-18, -78, 4, 3).fill(0xffffff).rect(10, -78, 4, 3).fill(0xffffff);
    this.goggles.rect(26, -98, 5, 26).fill(INK).rect(27, -97, 3, 24).fill(0xf5c211);
    this.goggles.visible = false;
    this.hat.poly([0, -124, -48, -90, 48, -90]).fill(INK).poly([0, -118, -41, -93, 41, -93]).fill(STRAW);
    this.hat.rect(-28, -100, 56, 3).fill(STRAW_DARK).rect(-14, -110, 28, 3).fill(STRAW_DARK);
    this.hat.visible = false;
    this.body.addChild(this.legs[0]!, this.legs[1]!, this.armL, this.upper, this.goggles, this.hat, this.armR);
    this.tag.anchor.set(0.5);
    this.addChild(this.body, this.tagBg, this.tag);
  }

  get pose(): WalkerPose {
    return this._pose;
  }
  set pose(p: WalkerPose) {
    this._pose = p;
    this.oar.visible = p === 'row';
    this.layoutTag();
  }
  get facing(): 1 | -1 {
    return this._facing;
  }
  set facing(f: 1 | -1) {
    this._facing = f;
    this.body.scale.x = f * this.k;
  }
  get holding(): Holding {
    return this._holding;
  }
  set holding(h: Holding) {
    this._holding = h;
    for (const [id, g] of this.items) g.visible = id === h;
    this.goggles.visible = h === 'goggles';
  }

  setPerson(name: string, opts: { shirt: number; official: boolean; seed: string }): void {
    const look = lookOf(opts.seed, opts.shirt, opts.official);
    this.official = opts.official;
    const pal = palette(look);
    const rows = [...W_HEAD, ...W_TORSO];
    this.upper.clear();
    if (look.long) this.upper.rect(-30, -82, 60, 26).fill(INK).rect(-27, -82, 54, 24).fill(look.hair);
    drawGrid(this.upper, rows, pal, W_PX, -35, -100);
    this.legs.forEach((g, i) => drawGrid(g.clear(), W_LEGS[i]!, pal, W_PX, -35, -15));
    for (const [g, ox] of [
      [this.armLG, 0],
      [this.armRG, 0]
    ] as const) {
      g.clear().rect(-5 + ox, -2, 10, 30).fill(INK).rect(-3 + ox, 0, 6, 22).fill(look.shirt).rect(-3 + ox, 22, 6, 5).fill(look.skin);
    }
    this.hat.visible = opts.official;
    this.tag.text = short(name, 18);
    this.layoutTag();
  }

  private layoutTag(): void {
    const k = this.k;
    let top = (this.official ? 124 : 100) * k;
    if (this._pose === 'swim') top = 70 * k;
    else if (this._pose === 'row') top -= 12 * k;
    this.tag.position.set(0, -top - 30);
    const w = this.tag.width + 28;
    this.tagBg.clear().rect(-w / 2 - 3, -top - 55, w + 6, 52).fill(INK).rect(-w / 2, -top - 52, w, 46).fill(0xff6b35);
  }

  private buildItems(): void {
    const at = (g: Graphics) => {
      g.position.set(0, 28);
      g.visible = false;
      this.armR.addChild(g);
      return g;
    };
    const bait = at(new Graphics());
    bait.rect(-7, -2, 14, 14).fill(INK).rect(-5, 0, 10, 10).fill(0x8a5a2b).rect(-3, 1, 3, 3).fill(0xc08a50);
    const ground = at(new Graphics());
    block(ground, -12, 0, 24, 24, 0xd9b77a, INK, 3);
    ground.rect(-12, 0, 24, 5).fill(0xb08a50).rect(-6, 8, 4, 4).fill(0xf5e2a8).rect(3, 14, 4, 4).fill(0xf5e2a8);
    const lure = at(new Graphics());
    lure.rect(-18, -12, 36, 46).fill({ color: 0xfff1a8, alpha: 0.35 });
    lure.rect(-7, 0, 14, 24).fill(INK).rect(-5, 2, 10, 20).fill(0xff5fa2).rect(-5, 9, 10, 4).fill(0xf5c211);
    lure.rect(-2, 24, 4, 6).fill(0xc0bfbc);
    const net = at(new Graphics());
    net.circle(0, 24, 24).stroke({ width: 3, color: 0xdeddda });
    net.moveTo(-24, 24).lineTo(24, 24).moveTo(0, 0).lineTo(0, 48).moveTo(-17, 7).lineTo(17, 41).moveTo(17, 7).lineTo(-17, 41).stroke({ width: 2, color: 0xc0bfbc });
    for (let i = 0; i < 8; i++) net.rect(Math.cos((i / 8) * Math.PI * 2) * 24 - 2, 24 + Math.sin((i / 8) * Math.PI * 2) * 24 - 2, 4, 4).fill(0x5e5c64);
    const drum = at(new Graphics());
    block(drum, -16, 2, 32, 32, 0xd4a017, INK, 3);
    drum.rect(-6, 12, 12, 12).fill(0xf5c211).rect(-4, 14, 4, 4).fill(0xfff1a8);
    drum.rect(14, -22, 5, 30).fill(0x6b4a2a).rect(12, -28, 9, 8).fill(0xe01b24);
    const scissors = at(new Graphics());
    scissors.rect(-8, 0, 7, 7).fill(0xe01b24).rect(1, 0, 7, 7).fill(0xe01b24);
    scissors.poly([-4, 6, 0, 6, 6, 30, 3, 32]).fill(0xc0bfbc).poly([4, 6, 0, 6, -6, 30, -3, 32]).fill(0xdeddda);
    this.items.set('bait', bait);
    this.items.set('ground_bait', ground);
    this.items.set('lure', lure);
    this.items.set('net', net);
    this.items.set('drum', drum);
    this.items.set('scissors', scissors);
    // mái chèo (tư thế chèo thuyền)
    this.oar.rect(-3, -6, 6, 70).fill(0x6b4a2a).rect(-8, 60, 16, 26).fill(INK).rect(-6, 62, 12, 22).fill(0x9a6a3a);
    this.oar.position.set(0, 26);
    this.oar.rotation = 0.5;
    this.oar.visible = false;
    this.armR.addChild(this.oar);
  }

  tick(dtMs: number): void {
    this.t += dtMs;
    const t = this.t;
    const k = this.k;
    const f = this._facing;
    let aL = 0.08;
    let aR = -0.08;
    let bx = 0;
    let by = 0;
    let rot = 0;
    let step = 0;
    let legs = true;
    switch (this._pose) {
      case 'walk':
        aL = Math.sin(t * 0.012) * 0.4;
        aR = -aL;
        step = Math.floor(t / 140) % 2;
        by = -Math.abs(Math.sin(t * 0.022)) * 5 * k;
        break;
      case 'throw':
        aR = -2.7 + Math.sin(t * 0.012) * 0.5;
        aL = 0.5;
        break;
      case 'cheer':
        aL = 2.6 + Math.sin(t * 0.016) * 0.35;
        aR = -aL;
        by = -Math.abs(Math.sin(t * 0.014)) * 12 * k;
        break;
      case 'scared':
        aL = 2.3;
        aR = -2.3;
        bx = Math.sin(t * 0.09) * 2 * k;
        break;
      case 'pull':
        aR = -1.35 + Math.sin(t * 0.02) * 0.08;
        aL = -1.15 + Math.sin(t * 0.02) * 0.08;
        rot = -0.24 * f;
        break;
      case 'swim':
        aL = Math.PI - 0.25 + Math.sin(t * 0.012) * 0.35;
        aR = -(Math.PI - 0.25) - Math.sin(t * 0.012) * 0.35;
        rot = (f * Math.PI) / 2;
        step = Math.floor(t / 120) % 2;
        bx = -50 * k * f;
        by = -40 * k + Math.sin(t * 0.005) * 4;
        break;
      case 'row':
        legs = false;
        aR = -0.9 + Math.sin(t * 0.008) * 0.5;
        aL = -0.7 + Math.sin(t * 0.008) * 0.5;
        by = 14 * k;
        break;
      default:
        break;
    }
    this.armL.rotation = aL;
    this.armR.rotation = aR;
    this.body.rotation = rot;
    this.body.position.set(bx, by);
    this.legs[0]!.visible = legs && step === 0;
    this.legs[1]!.visible = legs && step === 1;
  }
}

/** Cần thủ có tiến trình 0..1 → nội suy mượt (dùng chung cho các hoạt ảnh nhỏ). */
export const smooth = (p: number) => easeInOut(clamp01(p));
