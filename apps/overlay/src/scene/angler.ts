import { BitmapText, Container, Graphics, GraphicsContext, Sprite, Text, Texture } from 'pixi.js';
import { ROSTER_MAX, type CatchEvent, type RosterMember, type WorkEvent } from '@cau/shared';
import { anglerTexture, smallFishTexture } from './assets';
import { TAG_TEXT, type Anglers, type SeatSide, type Spot, type WalkerLike, type WalkerPose } from './contract';
import { block, drawGrid, hash, INK, type Palette } from './pixel';
import { clamp01, easeInOut, easeOut, lerp } from './util';

/*
 * Cần thủ quanh hồ:
 *   - hai bên bờ (trái / phải): ngồi nghiêng nhìn ra hồ, xếp cột dọc theo mép nước, cần câu chĩa ra mặt hồ
 *   - chiếu VIP (bờ xa, ngay dưới HUD trên): ngồi nhìn thẳng về phía người xem, to hơn, có sàn tre + hào quang,
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
/** Chiếu VIP trên bờ xa (ngay dưới HUD trên): sàn tre + chân người ngồi. lake.ts vẽ sàn theo các mốc này. */
export const FRONT = { x0: 300, x1: 780, deckTop: 628, deckBottom: 716, feetY: 686, max: 6, min: 5, scale: 0 };
/** Bố cục bờ bên: bờ xiên (vẽ tay) hay thẳng đứng (ảnh nền); khoảng cách cột người ngồi. */
const LAYOUT = { slanted: true, left: 132, right: 948, colDx: 64, edgeGap: 36 };

/**
 * Số đo trên ảnh nền 1080×1920 (public/bg/lake.png):
 *   mặt nước x 132–946, y 722–1620 (bờ thẳng đứng, góc bo tròn);
 *   lối đất bờ trái x 32–92, cỏ 92–132; bờ phải cỏ 948–990, lối đất 990–1050; y ≈ 780–1540;
 *   sàn tre VIP x 352–725, mặt sàn y 642, mép trước y 758 (chân cọc tới ~780); chiếu đỏ x 418–664, y 657–720.
 */
export function useImageGeometry(): void {
  Object.assign(WATER, { top: 722, bottom: 1620 });
  Object.assign(BANK, { top: 790, bottom: 1600 });
  // VIP to gấp ~1.6–1.8 lần người ngồi bờ: 5 ghế cách nhau ~75px trải hết sàn, chân trên sàn y≈735,
  // thân người nhô lên trên nền bờ xa (mong muốn); cần câu chĩa xuống nước ngay dưới mép sàn (y≈758).
  Object.assign(FRONT, { x0: 332, x1: 747, deckTop: 642, deckBottom: 758, feetY: 735, scale: 1.6 });
  // cột trong (sát nước) ngồi trên dải cỏ x≈106 / 974, cột ngoài trên lối đất x≈58 / 1022
  Object.assign(LAYOUT, { slanted: false, left: 132, right: 948, colDx: 48, edgeGap: 26 });
}

/** Mép nước của bờ trái / phải tại độ cao y (vẽ tay: bờ hơi xiên cho có chiều sâu; ảnh nền: thẳng đứng). */
export function bankEdge(side: 'left' | 'right', y: number): number {
  if (!LAYOUT.slanted) return side === 'left' ? LAYOUT.left : LAYOUT.right;
  const k = clamp01((y - WATER.top) / (WATER.bottom - WATER.top));
  const xl = lerp(196, 236, k);
  return side === 'left' ? xl : 1080 - xl;
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

// Ngồi nhìn thẳng về phía người xem (chiếu VIP bờ xa), chân thả trước mép chiếu. 12×17 ô → 48×68.
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
const stoolFace = () => (_stoolFace ??= block(new GraphicsContext(), -20, -12, 40, 9, 0xb8323a, INK, 2).rect(-14, -9, 28, 2).fill(0xf5c211));
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
/** Hào quang vàng sau lưng người ngồi chiếu giữa. */
const glowCtx = () =>
  (_glow ??= new GraphicsContext()
    .rect(-34, -78, 68, 84)
    .fill({ color: 0xffd166, alpha: 0.16 })
    .rect(-28, -86, 56, 96)
    .fill({ color: 0xffd166, alpha: 0.16 })
    .rect(-22, -92, 44, 104)
    .fill({ color: 0xfff1b8, alpha: 0.18 }));

// Một kiểu chữ bitmap dùng chung (tạo atlas động một lần), tô màu bằng tint.
const BMP_STYLE = { fontFamily: 'Segoe UI, Arial', fontSize: 24, fontWeight: '900' as const, fill: 0xffffff };
const bmp = (text = '') => {
  const t = new BitmapText({ text, style: BMP_STYLE });
  t.anchor.set(0.5);
  return t;
};
const short = (s: string, n: number) => [...s.trim()].slice(0, n).join('');

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
  plateBg: Graphics;
  plate: BitmapText;
  kgText: BitmapText | null;
  tagBg: Graphics;
  tag: BitmapText | null;
  glow: Graphics | null;
  lookKey: string;
  away: boolean;
  jerkAt: number;
  dipAt: number;
  trashUntil: number;
  emoteUntil: number;
}

/** Mức bố cục mỗi bên bờ: càng đông càng nhiều cột/hàng, người nhỏ lại. */
const SIDE_TIERS = [
  { cols: 2, rows: 4 }, // ≤ 20 người (kể cả chiếu VIP): ghế to, thoải mái
  { cols: 2, rows: 8 },
  { cols: 2, rows: 12 } // tới 50 người (2 cột so le, 24 chỗ mỗi bên)
] as const;
const PLATE_H = 16;
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
const MAX_EMOTES = 10;
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
  /** Bề ngang bảng tên chiếu VIP (đơn vị trước khi scale) — vừa khoảng cách ghế để không đè nhau. */
  private frontPlateW = 76;
  private byId = new Map<string, Seat>();
  private byName = new Map<string, Seat>();
  private t = 0;
  private react: 'cheer' | 'wet' | 'scared' | 'pull' | null = null;
  private pull = 0;
  private pending: { seat: Seat; e: CatchEvent; at: number }[] = [];
  private flies: Fly[] = [];
  private emotes: { node: Container; until: number; born: number }[] = [];

  constructor(
    readonly layer: Container,
    readonly fxLayer: Container
  ) {
    this.build(0, FRONT.min);
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

    // Chiếu VIP xếp theo hạng: kim cương trong phiên, hoà thì câu lâu hơn. this.seats bắt đầu bằng các ghế chiếu
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
      // rời hồ, server đổi khu ngồi, hoặc đổi hạng chiếu VIP → nhả chỗ để xếp lại
      if (!m) this.vacate(s);
      else if (s.side === 'front') {
        if (vipRank.get(id) !== frontSeats.indexOf(s)) this.vacate(s);
      } else if (m.seat === 'front' ? vipRank.has(id) : m.seat !== s.side) this.vacate(s);
    }
    vip.forEach((m, i) => this.occupy(frontSeats[i]!, m));
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
  }

  emote(e: WorkEvent, ms = 2600): void {
    const seat = this.byId.get(e.platformId) ?? this.spotOf(e.displayName);
    if (!seat) return;
    const now = performance.now();
    seat.emoteUntil = now + ms;
    while (this.emotes.length >= MAX_EMOTES) this.emotes.shift()!.node.destroy({ children: true });
    const node = new Container();
    const t = new Text({
      text: `${e.emoji} ${short(e.text, 24)}`,
      style: { fontFamily: 'Segoe UI, Arial', fontSize: 20, fontWeight: '800', fill: INK }
    });
    t.anchor.set(0.5);
    const w = t.width + 20;
    const bg = new Graphics();
    bg.rect(-w / 2 - 3, -19, w + 6, 38).fill(INK).rect(-w / 2, -16, w, 32).fill(0xffffff).rect(-6, 16, 12, 8).fill(INK);
    node.addChild(bg, t);
    const head = this.headTop(seat);
    node.position.set(Math.max(w / 2 + 6, Math.min(1080 - w / 2 - 6, head.x)), head.y - 26);
    this.fxLayer.addChild(node);
    this.emotes.push({ node, until: now + ms, born: now });
  }

  catches(events: CatchEvent[]): void {
    const now = performance.now();
    for (const e of events) {
      const seat = this.byId.get(e.platformId) ?? this.spotOf(e.displayName);
      if (!seat) continue;
      // thường mỗi chu kỳ chỉ 1 con (theo thứ tự vào hồ) → hiện ngay; lô nhiều con thì lệch pha cho đỡ đồng loạt
      const delay = events.length <= 1 ? 0 : Math.random() * Math.min(4000, events.length * 300);
      this.pending.push({ seat, e, at: now + delay });
    }
    if (this.pending.length > 400) this.pending.splice(0, this.pending.length - 400);
  }

  spotOf(displayName: string | undefined): Seat | undefined {
    return displayName ? this.byName.get(displayName.trim()) : undefined;
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

  reactAll(kind: 'cheer' | 'wet' | 'scared' | 'pull' | null): void {
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
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= now);
      if (due.length) {
        this.pending = this.pending.filter((p) => p.at > now);
        for (const p of due) this.land(p.seat, p.e, now);
      }
    }

    for (const f of this.flies) if (f.active) this.tickFly(f, now);

    this.emotes = this.emotes.filter((e) => {
      if (e.until <= now) {
        e.node.destroy({ children: true });
        return false;
      }
      e.node.alpha = Math.min(1, (e.until - now) / 400);
      e.node.pivot.y = Math.min(now - e.born, 600) * 0.03;
      return true;
    });

    const t = this.t;
    const pull = this.pull;
    for (const s of this.seats) {
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
    f.tx = Math.max(40, Math.min(1040, head.x));
    f.ty = head.y - 16;
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
    f.kg.text = e.kg > 0 ? `${e.kg.toFixed(1)}kg` : 'Ặc!';
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
    kg.scale.set(0.75);
    kg.y = 26;
    const label = bmp('');
    label.scale.set(0.5);
    label.y = -28;
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
    for (const s of this.seats) s.root.destroy({ children: true });
    this.seats = [];
    this.byId.clear();
    this.byName.clear();
    this.tier = tier;
    this.nFront = nFront;

    const { cols, rows } = SIDE_TIERS[tier]!;
    const span = BANK.bottom - BANK.top;
    const cellH = span / (cols > 1 ? rows + 0.5 : rows);
    const unitH = SIDE_H + PLATE_H + 2;
    // to hơn ô một chút (hàng trên/dưới chồng nhẹ lên nhau, vẽ theo y nên vẫn đúng thứ tự)
    // ít người (mức 0) cho to hẳn ra; đông thì giới hạn theo khoảng cách cột
    const s = Math.min((cellH / unitH) * 1.15, tier === 0 ? 1.5 : LAYOUT.colDx / 40, 1.5);

    // Thứ tự gán chỗ: cột trong cùng (sát nước) trước, từ trên xuống. Thứ tự vẽ: hàng trên trước, cột ngoài trước.
    const side: { side: 'left' | 'right'; r: number; c: number; x: number; y: number }[] = [];
    for (const which of ['left', 'right'] as const)
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++) {
          const cellTop = BANK.top + cellH * r + (c % 2 ? cellH / 2 : 0);
          const y = Math.round(cellTop + (cellH - unitH * s) / 2 + SIDE_H * s);
          const edge = bankEdge(which, y);
          const x = Math.round(which === 'left' ? edge - LAYOUT.edgeGap - c * LAYOUT.colDx : edge + LAYOUT.edgeGap + c * LAYOUT.colDx);
          side.push({ side: which, r, c, x, y });
        }
    const drawOrder = [...side].sort((a, b) => a.y - b.y || b.c - a.c);
    const seatOf = new Map<(typeof side)[number], Seat>();
    for (const d of drawOrder) seatOf.set(d, this.makeSeat(d.side, d.c, d.x, d.y, s));
    // danh sách gán chỗ theo cột → hàng
    const ordered = side.map((d) => seatOf.get(d)!);

    // chiếu giữa
    const fronts: Seat[] = [];
    const spacing = Math.min(100, (FRONT.x1 - FRONT.x0 - 40) / nFront);
    // ảnh nền: cỡ VIP cố định (co lại chút nếu 6 ghế); vẽ tay: theo khoảng cách ghế như cũ
    const fs = FRONT.scale ? FRONT.scale * Math.min(1, spacing / 75) : Math.min(1.5, spacing / 62);
    this.frontPlateW = Math.max(40, Math.min(76, Math.floor(spacing / fs) - 4));
    for (let i = 0; i < nFront; i++) {
      const x = Math.round(540 + (i - (nFront - 1) / 2) * spacing);
      fronts.push(this.makeSeat('front', 0, x, FRONT.feetY, fs));
    }
    // gán chỗ chiếu giữa từ giữa ra hai bên (người đứng đầu ngồi chính giữa)
    // #1 chính giữa, #2 bên phải, #3 bên trái, #4 phải tiếp, #5 trái tiếp…
    const frontOrder = [...fronts].sort((a, b) => Math.abs(a.x - 540) - Math.abs(b.x - 540) || b.x - a.x);
    this.seats = [...frontOrder, ...ordered];
    this.seats.forEach((x, i) => (x.index = i));
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

    // Bảng tên + thẻ (dưới chân, không lật)
    const front = view === 'face';
    const pw = front ? this.frontPlateW : 56;
    const plateBg = new Graphics();
    // VIP: bảng tên vàng viền nâu đậm
    if (front) block(plateBg, -pw / 2, 3, pw, 26, 0xffd166, 0x8f5b00, 2);
    else plateBg.rect(-pw / 2, 3, pw, 10).fill(0xffffff);
    plateBg.tint = 0xd8c7a8;
    const plate = bmp('');
    plate.tint = INK;
    plate.scale.set(front ? 0.42 : 0.36);
    plate.position.set(0, front ? 10 : 8);
    const kgText = front ? bmp('') : null;
    if (kgText) {
      kgText.tint = 0xb4471c;
      kgText.scale.set(0.34);
      kgText.position.set(0, 22);
    }
    const tagBg = new Graphics();
    const tag = front ? bmp('') : null;
    if (tag) {
      tag.scale.set(0.26);
      tag.position.set(0, 35);
    }
    tagBg.visible = false;
    if (tag) tag.visible = false;

    const kids: Container[] = [];
    if (glow) kids.push(glow);
    kids.push(stool, person, plateBg, plate);
    if (kgText) kids.push(kgText);
    kids.push(tagBg);
    if (tag) kids.push(tag);
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
      plateBg,
      plate,
      kgText,
      tagBg,
      tag,
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
    if (seat.kgText) {
      const kg = `${(m.kg ?? 0).toFixed(1)}kg`;
      if (seat.kgText.text !== kg) seat.kgText.text = kg;
    }
    seat.shirt = shirtFor(m.platformId);
    const look = lookOf(m.platformId, seat.shirt, m.follower);
    const key = `${look.shirt}|${look.hat}|${m.displayName}`;
    if (key === seat.lookKey) return;
    seat.lookKey = key;
    // chiếu VIP chỉ có 3 ảnh nhìn thẳng → chia theo ghế để hai người cạnh nhau không trùng ảnh
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
    seat.plate.text = short(m.displayName, seat.view === 'face' ? 12 : 10);
    if (seat.view === 'face') {
      // chữ to nhất có thể nhưng không tràn bảng tên
      seat.plate.scale.set(0.42);
      const max = this.frontPlateW - 6;
      if (seat.plate.width > max) seat.plate.scale.set((0.42 * max) / seat.plate.width);
    }
    seat.plateBg.tint = 0xffffff;
    const tag = m.follower ? TAG.official : TAG.rookie;
    const front = seat.view === 'face';
    const w = front ? Math.min(52, this.frontPlateW - 4) : 56;
    seat.tagBg.clear().rect(-w / 2, front ? 30 : 13, w, front ? 10 : 4).fill(tag.color);
    seat.tagBg.visible = true;
    if (seat.tag) {
      seat.tag.text = tag.text;
      seat.tag.visible = true;
    }
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
    seat.plate.text = '';
    if (seat.kgText) seat.kgText.text = '';
    seat.plateBg.tint = 0xd8c7a8;
    seat.tagBg.visible = false;
    if (seat.tag) seat.tag.visible = false;
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
