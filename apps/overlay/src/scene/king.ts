import { Container, Graphics, GraphicsContext, Sprite, type Texture } from 'pixi.js';
import type { Mood } from '@cau/shared';
import { bigFishTexture } from './assets';
import type { KingLike } from './contract';
import { drawGrid, INK, type Palette } from './pixel';
import { clamp01, lerp } from './util';

/*
 * Cá Thần: cá trê khổng lồ râu dài, vảy vàng, đội vương miện. Vẽ pixel (nhìn nghiêng, đầu bên trái).
 * Gốc (0,0) = tâm thân cá. Trên hồ: phần dưới mặt nước bị che (chỉ còn bóng mờ), rise nâng cá lên.
 * Dưới đáy hồ (submerged = false): vẽ nguyên con, không mặt nước.
 */

const PX = 6;
const FISH = [
  '.....K.K.K..........KKKKK.......................',
  '....KGKGKGK........KFFFFFK......................',
  '....KGRGRGKKKKKKKKKFFFFFFFKKKKKKKK..............',
  '...KKKKKKKKBBBBBBBBBBBBBBBBBBBBBBKKK.......KKKK.',
  '..KBBBBBBBBBGBBBGBBBGBBBGBBBGBBBBBBBKK...KKFFFK.',
  '.KBBBBBBBBBBBGBBBGBBBGBBBGBBBGBBBBBBBBKKKFFFFK..',
  'KBBBBBBBBbbbbgbbbbgbbbbgbbbbgbbbbbbbbbBBFFFFK...',
  'KBBBBBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbFFFK...',
  'KBBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbFFK...',
  'KbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbFFK..',
  'KKYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYbbbFFFK.',
  '.KYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYbbFFFFK',
  '..KKYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYKKKKKKFFFK',
  '...KKYYYYYYKFFKYYYYYYYYYYYYYYYYYYYYYKKK....KKKK.',
  '....KKKKKKKFFFKKKKKKKKKKKKKKKKKKKKKKK...........',
  '..........KFFFFK................................',
  '..........KKKKKK................................'
];
const COLS = Math.max(...FISH.map((r) => r.length));
const ROWS = FISH.length;
export const KING_W = COLS * PX;
export const KING_H = ROWS * PX;
const OX = -KING_W / 2;
const OY = -KING_H / 2;
const PAL: Palette = { K: INK, B: 0x4f5f33, b: 0x6f8445, g: 0xf5c211, Y: 0xe9dca6, G: 0xf5c211, R: 0xe01b24, F: 0x3e4b28 };
/** Toạ độ ô lưới → toạ độ thân cá. */
const C = (c: number, r: number) => [OX + c * PX, OY + r * PX] as const;
/** Mép nước (toạ độ cá) khi đang ở hồ. */
const WL = KING_H * 0.3;

let bodyCtx: GraphicsContext | null = null;
function bodyContext(): GraphicsContext {
  if (bodyCtx) return bodyCtx;
  bodyCtx = drawGrid(new GraphicsContext(), FISH, PAL, PX, OX, OY);
  // ánh vàng trên vảy
  for (let c = 13; c < 34; c += 4) {
    const [x, y] = C(c, 4);
    bodyCtx.rect(x + 1, y + 1, 2, 2).fill(0xfff1a8);
  }
  return bodyCtx;
}

let rippleCtx: GraphicsContext | null = null;
function rippleContext(): GraphicsContext {
  if (rippleCtx) return rippleCtx;
  rippleCtx = new GraphicsContext();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    rippleCtx.rect(Math.round(Math.cos(a) * KING_W * 0.55) - 4, Math.round(Math.sin(a) * 14) - 1, 8, 3).fill({ color: 0xe6f6ff, alpha: 0.8 });
  }
  return rippleCtx;
}

const MOOD_TINT: Record<Mood, number> = {
  calm: 0xffffff,
  curious: 0xfff2c8,
  agitated: 0xffc9a0,
  thrashing: 0xff9a8a,
  exhausted: 0xbfc6bf
};
/** Mức quẫy tự nhiên theo tâm trạng (cộng thêm vào `thrash` do hoạt ảnh đặt). */
const MOOD_THRASH: Record<Mood, number> = { calm: 0, curious: 0.04, agitated: 0.12, thrashing: 0.3, exhausted: 0 };

type Expr = 'hit' | 'shock' | 'dizzy' | 'happy' | 'chomp';
type Eye = 'sleepy' | 'open' | 'wide' | 'angry' | 'x' | 'squint' | 'happy' | 'spiral';
type Mouth = 'smile' | 'flat' | 'frown' | 'teeth' | 'o' | 'tongue' | 'wave' | 'chomp';

const FACE: Record<Mood | Expr, [Eye, Mouth]> = {
  calm: ['sleepy', 'smile'],
  curious: ['wide', 'flat'],
  agitated: ['angry', 'frown'],
  thrashing: ['angry', 'teeth'],
  exhausted: ['x', 'tongue'],
  hit: ['squint', 'teeth'],
  shock: ['wide', 'o'],
  dizzy: ['spiral', 'wave'],
  happy: ['happy', 'smile'],
  chomp: ['open', 'chomp']
};

export class King extends Container implements KingLike {
  rise = 0.3;
  thrash = 0;
  spin = 0;
  whisker = 1;
  bellyUp = false;

  private mood: Mood = 'calm';
  private expr: Expr | null = null;
  private readonly submerged: boolean;
  private wrap = new Container();
  private body = new Graphics(bodyContext());
  /** Ảnh cá thần (ô "pull_legend" của big-fish.png) — có ảnh thì thay thân cá vẽ pixel. */
  private art: Sprite | null = null;
  private face = new Graphics();
  private whiskers = new Graphics();
  private shadowWrap: Container | null = null;
  private aboveMask: Graphics | null = null;
  private belowMask: Graphics | null = null;
  private ripples: Graphics[] = [];
  private faceKey = '';
  private t = Math.random() * 10_000;

  constructor(opts: { submerged?: boolean } = {}) {
    super();
    this.submerged = opts.submerged ?? true;
    const tex = bigFishTexture('pull_legend');
    this.wrap.addChild(this.body, this.whiskers, this.face);
    if (tex) {
      this.art = artSprite(tex);
      this.body.visible = this.whiskers.visible = this.face.visible = false;
      this.wrap.addChild(this.art);
    }
    if (this.submerged) {
      // Trên hồ chỉ có BÓNG cá đen mờ dưới nước — không bao giờ nhô cả con cá lên mặt nước.
      this.shadowWrap = new Container();
      // bóng cá mềm: thân bầu dục + vây + đuôi, đầu bên trái (ảnh cá to đều ở tư thế nhảy cong người, làm bóng trông lạ)
      const L = KING_W / 2;
      const shadow = new Graphics()
        .ellipse(-L * 0.08, 0, L * 0.82, KING_H * 0.3)
        .fill(0x0b1e28)
        .poly([L * 0.6, 0, L * 1.02, -KING_H * 0.34, L * 0.92, 0, L * 1.02, KING_H * 0.34])
        .fill(0x0b1e28)
        .poly([-L * 0.2, -KING_H * 0.24, L * 0.15, -KING_H * 0.44, L * 0.2, -KING_H * 0.22])
        .fill(0x0b1e28)
        .poly([-L * 0.35, KING_H * 0.2, -L * 0.15, KING_H * 0.42, -L * 0.05, KING_H * 0.2])
        .fill(0x0b1e28);
      shadow.alpha = 0.45;
      this.shadowWrap.addChild(shadow);
      // belowMask không gắn vào cây hiển thị (bóng hiện nguyên hình); giữ để tick() không phải rẽ nhánh
      this.belowMask = new Graphics();
      this.aboveMask = new Graphics();
      this.wrap.mask = this.aboveMask;
      this.wrap.visible = false;
      for (let i = 0; i < 2; i++) {
        const r = new Graphics(rippleContext());
        r.y = WL;
        this.ripples.push(r);
      }
      this.addChild(this.shadowWrap, ...this.ripples, this.wrap, this.aboveMask);
    } else {
      this.addChild(this.wrap);
    }
    this.redrawFace();
    this.tick(0);
  }

  setMood(m: Mood): void {
    if (m === this.mood) return;
    this.mood = m;
    this.body.tint = MOOD_TINT[m];
    if (this.art) this.art.tint = MOOD_TINT[m];
    this.redrawFace();
  }

  setExpression(e: Expr | null): void {
    this.expr = e;
    this.redrawFace();
  }

  tick(dtMs: number): void {
    this.t += dtMs;
    const t = this.t;
    const belly = this.bellyUp || this.mood === 'exhausted';
    const rise = this.submerged ? clamp01(belly ? Math.max(this.rise, 0.6) : this.rise) : 1;
    const thrash = clamp01(this.thrash + MOOD_THRASH[this.mood]);

    const bob = Math.sin(t * 0.002) * 3;
    const offY = this.submerged ? lerp(KING_H * 0.62, 0, Math.min(1, rise / 0.8)) : 0;
    const wig = Math.sin(t * 0.03) * 0.18 * thrash;
    for (const w of [this.wrap, this.shadowWrap]) {
      if (!w) continue;
      w.position.set(Math.sin(t * 0.05) * 10 * thrash, offY + bob);
      w.rotation = this.spin + wig;
      w.scale.y = belly ? -1 : 1;
    }

    if (this.aboveMask && this.belowMask) {
      // rise 0.8 → 1: cá nhảy hẳn khỏi mặt nước (mặt nạ mở dần cho thấy nguyên con)
      const reveal = rise > 0.8 ? ((rise - 0.8) / 0.2) * KING_H * 1.6 : 0;
      const line = WL + reveal;
      this.aboveMask.clear().rect(-KING_W, -KING_H * 3, KING_W * 2, KING_H * 3 + line).fill(0xffffff);
      this.belowMask.clear().rect(-KING_W, line, KING_W * 2, KING_H * 2).fill(0xffffff);
      this.ripples.forEach((r, i) => {
        const k = ((t / 2400 + i * 0.5) % 1 + 1) % 1;
        r.scale.set(0.75 + k * 0.6 + thrash * 0.2, 0.75 + k * 0.6);
        r.alpha = (1 - k) * 0.45;
      });
    }
    if (!this.art) this.drawWhiskers(t, thrash);
  }

  private drawWhiskers(t: number, thrash: number): void {
    const g = this.whiskers.clear();
    const n = Math.round(clamp01(this.whisker) * 18) + 1;
    const anchors: [number, number, number, number][] = [
      // cột, hàng, độ cong xuống, độ dài
      [1, 9, 0.9, 1],
      [2, 9.4, -0.6, 0.85],
      [3, 11, 1.4, 0.6],
      [5, 11.4, 1.8, 0.5]
    ];
    anchors.forEach(([c, r, curl, len], wi) => {
      const [ax, ay] = C(c, r);
      const m = Math.max(1, Math.round(n * len));
      for (let i = 0; i < m; i++) {
        const wave = Math.sin(i * 0.45 - t * (0.004 + thrash * 0.02) + wi) * (2 + i * 0.35);
        const x = Math.round((ax - i * 6) / 2) * 2;
        const y = Math.round((ay + i * curl * 1.4 + wave) / 2) * 2;
        g.rect(x, y, 7, 4).fill(INK);
        if (i % 3 === 1) g.rect(x + 1, y + 1, 3, 1).fill(0x8a7a50);
      }
    });
  }

  private redrawFace(): void {
    const [eye, mouth] = FACE[this.expr ?? this.mood];
    const key = `${eye}|${mouth}|${this.mood}`;
    if (key === this.faceKey) return;
    this.faceKey = key;
    const g = this.face.clear();
    const red = this.mood === 'thrashing' && !this.expr;
    for (const c of [5, 10]) drawEye(g, c, 4, eye, red);
    drawMouth(g, mouth);
    if (eye === 'happy') {
      const [x, y] = C(4, 7);
      g.rect(x, y, 12, 5).fill({ color: 0xff8fa8, alpha: 0.8 });
    }
  }
}

/** Ảnh cá to quay đầu sang PHẢI → lật cho đầu bên trái như cá vẽ pixel; vừa khung KING_W × KING_H (nhỉnh hơn chút). */
function artSprite(tex: Texture): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  const k = Math.min((KING_W * 1.15) / tex.width, (KING_H * 1.6) / tex.height);
  s.scale.set(-k, k);
  return s;
}

function drawEye(g: Graphics, c: number, r: number, kind: Eye, red: boolean): void {
  const [x, y] = C(c, r);
  const S = PX * 2;
  const white = red ? 0xffd0c8 : 0xffffff;
  switch (kind) {
    case 'sleepy':
      g.rect(x - 1, y + PX - 1, S + 2, PX + 2).fill(INK).rect(x + 1, y + PX, S - 2, PX - 2).fill(white).rect(x + 1, y + PX, 4, 4).fill(INK);
      g.rect(x - 2, y + PX - 3, S + 4, 3).fill(INK);
      break;
    case 'open':
    case 'angry':
    case 'wide': {
      const pad = kind === 'wide' ? 2 : 0;
      g.rect(x - 2 - pad, y - 2 - pad, S + 4 + pad * 2, S + 4 + pad * 2).fill(INK).rect(x - pad, y - pad, S + pad * 2, S + pad * 2).fill(white);
      const p = kind === 'wide' ? 3 : PX;
      g.rect(x + 1, y + S / 2 - p / 2, p, p).fill(red ? 0x8a0000 : INK);
      if (kind === 'angry') g.rect(x - 4, y - 8, 8, 4).fill(INK).rect(x + 4, y - 6, 8, 4).fill(INK).rect(x + 10, y - 3, 4, 3).fill(INK);
      if (kind === 'wide') g.rect(x - 2, y - 10, S + 4, 3).fill(INK);
      break;
    }
    case 'x':
      for (let i = 0; i < 4; i++) {
        g.rect(x + i * 3, y + i * 3, 4, 4).fill(INK);
        g.rect(x + 9 - i * 3, y + i * 3, 4, 4).fill(INK);
      }
      break;
    case 'squint':
      g.rect(x, y + 2, 4, 3).fill(INK).rect(x + 4, y + 5, 4, 3).fill(INK).rect(x, y + 8, 4, 3).fill(INK);
      g.rect(x + 8, y + 2, 4, 3).fill(INK).rect(x + 8, y + 8, 4, 3).fill(INK);
      break;
    case 'happy':
      g.rect(x, y + 6, 4, 4).fill(INK).rect(x + 4, y + 2, 4, 4).fill(INK).rect(x + 8, y + 6, 4, 4).fill(INK);
      break;
    case 'spiral':
      g.rect(x - 2, y - 2, S + 4, S + 4).fill(INK).rect(x, y, S, S).fill(white);
      g.rect(x + 2, y + 2, S - 4, S - 4).fill(INK).rect(x + 4, y + 4, S - 8, S - 8).fill(white);
      break;
  }
}

function drawMouth(g: Graphics, kind: Mouth): void {
  const [x0, y0] = C(0, 9);
  switch (kind) {
    case 'smile':
      g.rect(x0 + 2, y0 + 2, 30, 4).fill(INK).rect(x0 + 30, y0 - 2, 8, 4).fill(INK);
      break;
    case 'flat':
      g.rect(x0 + 2, y0 + 3, 38, 4).fill(INK);
      break;
    case 'frown':
      g.rect(x0 + 2, y0 + 2, 30, 4).fill(INK).rect(x0 + 30, y0 + 6, 8, 4).fill(INK);
      break;
    case 'teeth':
      g.rect(x0, y0 - 2, 36, 16).fill(INK).rect(x0 + 2, y0, 32, 12).fill(0x8a2b2b);
      for (let i = 0; i < 4; i++) g.rect(x0 + 4 + i * 8, y0, 4, 4).fill(0xffffff).rect(x0 + 4 + i * 8, y0 + 8, 4, 4).fill(0xffffff);
      break;
    case 'o':
      g.rect(x0 + 2, y0 - 2, 16, 16).fill(INK).rect(x0 + 5, y0 + 1, 10, 10).fill(0x8a2b2b);
      break;
    case 'tongue':
      g.rect(x0 + 2, y0, 26, 8).fill(INK).rect(x0 + 4, y0 + 6, 10, 10).fill(0xff7a8a).rect(x0 + 8, y0 + 6, 2, 8).fill(0xd9485c);
      break;
    case 'wave':
      for (let i = 0; i < 5; i++) g.rect(x0 + 2 + i * 7, y0 + (i % 2 ? 0 : 4), 7, 4).fill(INK);
      break;
    case 'chomp':
      g.rect(x0 - 4, y0 - 10, 46, 32).fill(INK).rect(x0 - 2, y0 - 8, 42, 28).fill(0x5a1a1a);
      for (let i = 0; i < 5; i++) g.rect(x0 + i * 8, y0 - 8, 4, 6).fill(0xffffff).rect(x0 + i * 8, y0 + 14, 4, 6).fill(0xffffff);
      break;
  }
}
