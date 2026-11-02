import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { drawGrid, hash, INK, type Palette } from './pixel';

/** Kích thước một "pixel" của nhân viên. Lưới 14×17 (ngồi) / 14×20 (đứng). */
export const STAFF_PX = 5;
export const STAFF_W = 14 * STAFF_PX;

// Đầu: 9 hàng. H = tóc, S = da, E = mắt, M = miệng.
const HEADS = {
  short: [
    '....KKKKKK....',
    '...KHHHHHHK...',
    '..KHHHHHHHHK..',
    '..KHSSSSSSHK..',
    '..KSSSSSSSSK..',
    '..KSESSSSESK..',
    '..KSSSSSSSSK..',
    '...KSSMMSSK...',
    '....KKKKKK....'
  ],
  long: [
    '....KKKKKK....',
    '...KHHHHHHK...',
    '..KHHHHHHHHK..',
    '.KHHSSSSSSHHK.',
    '.KHSSSSSSSSHK.',
    '.KHSESSSSESHK.',
    '.KHSSSSSSSSHK.',
    '.KHHSSMMSSHHK.',
    '.KHHKKKKKKHHK.'
  ],
  spiky: [
    '...K.KK.KK.K..',
    '..KHKHHKHHKHK.',
    '..KHHHHHHHHK..',
    '..KHSSSSSSHK..',
    '..KSSSSSSSSK..',
    '..KSESSSSESK..',
    '..KSSSSSSSSK..',
    '...KSSMMSSK...',
    '....KKKKKK....'
  ],
  bun: [
    '.....KKKK.....',
    '....KHHHHK....',
    '...KHHHHHHK...',
    '..KHHSSSSHHK..',
    '..KSSSSSSSSK..',
    '..KSESSSSESK..',
    '..KSSSSSSSSK..',
    '...KSSMMSSK...',
    '....KKKKKK....'
  ]
} as const;
type HairStyle = keyof typeof HEADS;
const STYLES = Object.keys(HEADS) as HairStyle[];

// Thân (ngồi sau bàn): 8 hàng. C = áo, W = cổ áo trắng, T = cà vạt.
const BODY = [
  '..KKCCWWCCKK..',
  '.KCCCCWWCCCCK.',
  'KCCCCCTTCCCCCK',
  'KCCKCCTTCCKCCK',
  'KSSKCCWWCCKSSK',
  'KKKKCCCCCCKKKK',
  '...KCCCCCCK...',
  '...KKKKKKKK...'
];
// Chân (khi đứng/đi): 2 khung để tạo bước đi.
const LEGS = [
  ['...KPPKKPPK...', '...KPPKKPPK...', '..KOOOKKOOOK..'],
  ['..KPPK..KPPK..', '..KPPK..KPPK..', '.KOOOK..KOOOK.']
] as const;

const HAIR = [0x2b1d16, 0x4a2f1f, 0x1b1b24, 0x7a4a2a, 0x9c5a2a];
const SKIN = [0xf6c9a0, 0xeab58b, 0xd69e70];

// ---------------------------------------------------------------------------
// Sprite nhân viên (cắt từ assets-src/staff-sheet.png bằng `bun run sprites:staff`)
// ---------------------------------------------------------------------------
export const STAFF_POSES = ['idle', 'walk', 'angry', 'shout', 'scared', 'cheer', 'phone', 'tablet', 'seated'] as const;
export type StaffPose = (typeof STAFF_POSES)[number];
/** Tư thế → chỉ số khung (walk: nhiều khung). */
export type StaffPoseMap = Record<StaffPose, number | number[]>;

export interface StaffCharacter {
  /** Toàn bộ khung (chung kích thước, gốc ở giữa mép dưới khi anchor = (0.5, 1)). */
  frames: Texture[];
  /** Vùng có hình của từng khung [x, y, w, h] trong khung. */
  boxes: number[][];
  frameW: number;
  frameH: number;
}

interface StaffSheet {
  chars: StaffCharacter[];
  poses: StaffPoseMap;
}
let staff: StaffSheet | null = null;

/** Gọi từ main.ts sau khi tải xong sprite (trước buildOffice). Không gọi → dùng người vẽ pixel. */
export function setStaffSprites(chars: StaffCharacter[], poses: StaffPoseMap): void {
  staff = chars.length ? { chars, poses } : null;
}
export const hasStaffSprites = (): boolean => staff !== null;

/** Nhân vật sprite của một ngoại hình (null nếu chưa có sprite). */
export function staffCharacter(look: Look): StaffCharacter | null {
  return staff ? staff.chars[look.character % staff.chars.length]! : null;
}

/** Các khung của một tư thế (walk có nhiều khung, còn lại 1). */
export function staffFrames(ch: StaffCharacter, pose: StaffPose): Texture[] {
  const idx = staff?.poses[pose] ?? 0;
  return (Array.isArray(idx) ? idx : [idx]).map((i) => ch.frames[i] ?? ch.frames[0]!);
}

/** Chiều cao thân người (khung đứng yên) — để quy đổi sprite về đúng cỡ người vẽ pixel. */
export function staffBodyH(ch: StaffCharacter): number {
  const i = staff?.poses.idle;
  return ch.boxes[typeof i === 'number' ? i : 0]?.[3] ?? ch.frameH;
}

/** Chiều cao người đứng vẽ pixel (20 hàng) — sprite được co về cỡ này. */
export const STAFF_STAND_H = 20 * STAFF_PX;

export interface Look {
  /** Chỉ số nhân vật sprite (lấy theo modulo số nhân vật có sẵn). */
  character: number;
  style: HairStyle;
  hair: number;
  skin: number;
  shirt: number;
  glasses: boolean;
  tie: boolean;
}

/** Ngoại hình cố định theo tên → cùng một người luôn trông giống nhau. */
export function lookFor(name: string, shirt: number): Look {
  const h = hash(name);
  return {
    character: mix(h) % 9973, // trộn bit: id gần giống nhau (vd số TikTok) vẫn ra nhân vật khác nhau
    style: STYLES[h % STYLES.length]!,
    hair: HAIR[(h >> 3) % HAIR.length]!,
    skin: SKIN[(h >> 6) % SKIN.length]!,
    shirt,
    glasses: (h >> 9) % 3 === 0,
    tie: (h >> 11) % 2 === 0
  };
}

/** Vẽ nhân viên, gốc toạ độ ở giữa mép dưới. legs = null: chỉ nửa trên (ngồi sau bàn). */
export function drawPerson(g: Graphics, look: Look, legs: 0 | 1 | null = null): Graphics {
  const px = STAFF_PX;
  const rows = [...HEADS[look.style], ...BODY, ...(legs === null ? [] : LEGS[legs])];
  const pal: Palette = {
    K: INK,
    H: look.hair,
    S: look.skin,
    E: INK,
    M: 0xb03a3a,
    C: look.shirt,
    W: 0xffffff,
    T: look.tie ? 0xc01c28 : 0xffffff,
    P: 0x2d3142,
    O: 0x111111
  };
  const ox = -STAFF_W / 2;
  const oy = -rows.length * px;
  drawGrid(g, rows, pal, px, ox, oy);
  if (look.glasses) {
    for (const c of [3, 8]) g.rect(ox + c * px - 1, oy + 5 * px - 2, 3 * px + 2, px + 4).stroke({ width: 2, color: INK });
    g.rect(ox + 6 * px, oy + 5 * px + 1, 2 * px, 2).fill(INK);
  }
  return g;
}

/** Biển "ĐÌNH CÔNG" cầm tay. */
export function strikeSign(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(-3, -36, 6, 50).fill(0x8f5b34);
  g.rect(-50, -84, 100, 50).fill(INK);
  g.rect(-46, -80, 92, 42).fill(0xffffff);
  const t = new Text({
    text: 'ĐÌNH\nCÔNG',
    style: { fontFamily: 'Segoe UI, Arial', fontSize: 17, fontWeight: '900', fill: 0xe01b24, align: 'center', lineHeight: 18 }
  });
  t.anchor.set(0.5);
  t.position.set(0, -59);
  c.addChild(g, t);
  c.visible = false;
  return c;
}

/**
 * Nhân viên đứng/đi: dùng sprite (đứng yên / chu kỳ bước đi / tư thế riêng) nếu đã tải,
 * không thì 2 khung chân vẽ pixel. Bảng tên trên đầu.
 */
export class Walker extends Container {
  private frames = [new Graphics(), new Graphics()];
  private sprite = new Sprite();
  private char: StaffCharacter | null = null;
  private walkTex: Texture[] = [];
  private poseName: StaffPose | null = null;
  private body = new Container();
  private tagBg = new Graphics();
  private tag = new Text({ text: '', style: { fontFamily: 'Segoe UI, Arial', fontSize: 30, fontWeight: '900', fill: 0xffffff } });
  readonly can = new Graphics();
  walking = false;
  private t = 0;

  constructor(scale = 1.7) {
    super();
    this.body.scale.set(scale);
    this.body.addChild(...this.frames);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.visible = false;
    this.body.addChild(this.sprite);
    // bình xịt cầm tay
    this.can.rect(0, -10, 10, 18).fill(0xe5a50a).rect(2, -14, 6, 4).fill(INK);
    this.can.position.set(STAFF_W / 2 - 4, -40);
    this.can.visible = false;
    this.body.addChild(this.can);
    this.tag.anchor.set(0.5);
    this.addChild(this.body, this.tagBg, this.tag);
  }

  setPerson(name: string, look: Look): void {
    this.char = staffCharacter(look);
    if (this.char) {
      this.frames.forEach((f) => (f.clear().visible = false));
      this.walkTex = staffFrames(this.char, 'walk');
      this.sprite.scale.set(STAFF_STAND_H / staffBodyH(this.char));
      this.sprite.visible = true;
      this.sprite.texture = this.char.frames[0]!;
    } else {
      this.sprite.visible = false;
      this.frames.forEach((f, i) => drawPerson(f.clear(), look, i as 0 | 1));
    }
    this.tag.text = [...name].slice(0, 18).join('');
    const h = 20 * STAFF_PX * this.body.scale.y;
    this.tag.position.set(0, -h - 34);
    const w = this.tag.width + 28;
    this.tagBg.clear().rect(-w / 2 - 3, -h - 59, w + 6, 56).fill(INK).rect(-w / 2, -h - 56, w, 50).fill(0xff6b35);
  }

  /** Dịch bảng tên sang ngang (vd để không che vật đang tương tác). */
  shiftTag(dx: number): void {
    this.tag.x = dx;
    this.tagBg.x = dx;
  }

  /** Nửa bề rộng bảng tên (px). */
  get tagHalfW(): number {
    return this.tag.width / 2 + 17;
  }

  /** Ngồi xổm (0..1). */
  crouch(k: number): void {
    this.body.scale.y = Math.abs(this.body.scale.x) * (1 - 0.18 * k);
  }

  /** Quay mặt sang phải (1) hoặc trái (-1) — chỉ lật thân, không lật bảng tên. */
  face(dir: 1 | -1): void {
    this.body.scale.x = dir * Math.abs(this.body.scale.x);
  }

  /**
   * Giữ một tư thế (vd 'cheer', 'angry', 'phone', 'scared'); null = tự động (đứng yên / bước đi).
   * Chỉ có tác dụng khi dùng sprite; hình vẽ pixel bỏ qua.
   */
  pose(name: StaffPose | null): void {
    this.poseName = name;
  }

  tick(dtMs: number): void {
    this.t += dtMs;
    if (this.char) {
      let tex: Texture;
      if (this.poseName && this.poseName !== 'walk') tex = staffFrames(this.char, this.poseName)[0]!;
      else if (this.walking || this.poseName === 'walk') tex = this.walkTex[Math.floor(this.t / 130) % this.walkTex.length]!;
      else tex = staffFrames(this.char, 'idle')[0]!;
      if (this.sprite.texture !== tex) this.sprite.texture = tex;
    } else {
      const step = Math.floor(this.t / 140) % 2;
      this.frames[0]!.visible = !this.walking || step === 0;
      this.frames[1]!.visible = this.walking && step === 1;
    }
    this.body.y = this.walking ? -Math.abs(Math.sin(this.t * 0.022)) * 6 : 0;
  }
}

/** Trộn bit (finalizer kiểu murmur) cho các hash của chuỗi gần giống nhau. */
function mix(h: number): number {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 16;
  x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 16;
  return x >>> 0;
}
