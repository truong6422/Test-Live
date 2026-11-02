import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Mood } from '@sep/shared';
import { drawGrid, INK } from './pixel';

const PX = 5;

const SKIN: Record<Mood, number> = {
  normal: 0xf6c9a0,
  annoyed: 0xf3b98f,
  angry: 0xf08a6a,
  panic: 0xf6d3b5,
  helpless: 0xd9c8bb
};

// Đầu trọc bóng (L = vệt sáng), H = tóc mai hai bên. 20×12.
const HEAD = [
  '.......KKKKKK.......',
  '.....KKSSSSSSKK.....',
  '....KSSLLSSSSSSK....',
  '...KSSLSSSSSSSSSK...',
  '..KSSSSSSSSSSSSSSK..',
  '.KHKSSSSSSSSSSSSKHK.',
  '.KHSSSSSSSSSSSSSSHK.',
  '.KSSSSSSSSSSSSSSSSK.',
  '..KSSSSSSSSSSSSSSK..',
  '...KSSSSSSSSSSSSK...',
  '....KKSSSSSSSSKK....',
  '......KKKKKKKK......'
];
// Thân mặc vest, cà vạt đỏ. 20×17.
const BODY = [
  '........KSSK........',
  '...KKBBBWTTWBBBKK...',
  '..KBBBBBWTTWBBBBBK..',
  '.KBBBBBBWTTWBBBBBBK.',
  '.KBBKBBBBTTBBBBKBBK.',
  '.KBBKBBBBTTBBBBKBBK.',
  '.KBBKBBBBBBBBBBKBBK.',
  '.KBBKBBBBBBBBBBKBBK.',
  '.KSSKBBBBBBBBBBKSSK.',
  '.KKKKBBBBBBBBBBKKKK.',
  '....KBBBBBBBBBBK....',
  '....KPPPPKKPPPPK....',
  '....KPPPPKKPPPPK....',
  '....KPPPPKKPPPPK....',
  '....KPPPK..KPPPK....',
  '...KOOOOK..KOOOOK...',
  '...KKKKKK..KKKKKK...'
];
const BODY_H = BODY.length * PX;
const W = 20 * PX;

export type Expression = Mood | 'hit' | 'shock';

/** Tên các tư thế cắt từ sheet ảnh Sếp (apps/overlay/public/sprites/boss/<tên>.png). */
export const BOSS_POSES = [
  'shocked', 'furious', 'shouting', 'blaming', 'weary', 'walking', 'thinking', 'cold', 'pleased', 'despair',
  'inspect', 'signing', 'phone', 'sos', 'throw_docs', 'scold_staff', 'praise_staff', 'computer', 'coffee', 'motorbike'
] as const;
export type BossPose = (typeof BOSS_POSES)[number];

const MOOD_POSE: Record<Expression, BossPose> = {
  normal: 'cold',
  annoyed: 'thinking',
  angry: 'furious',
  panic: 'shocked',
  helpless: 'weary',
  hit: 'shouting',
  shock: 'shocked'
};
/** Vị trí Sếp theo chiều ngang trong ảnh (ảnh có kèm bàn/máy tính/nhân viên thì Sếp lệch trái). */
const ANCHOR_X: Partial<Record<BossPose, number>> = {
  computer: 0.3, inspect: 0.3, scold_staff: 0.25, praise_staff: 0.25, throw_docs: 0.33, blaming: 0.33, shouting: 0.4, signing: 0.55
};
const SPRITE_SCALE = 0.68;

let sheet: Partial<Record<BossPose, Texture>> = {};
/** Gọi một lần sau khi tải ảnh, trước khi dựng cảnh. Không gọi → dùng Sếp vẽ pixel. */
export function setBossSprites(t: Partial<Record<BossPose, Texture>>): void {
  sheet = t;
}

/** Hoạt ảnh từng khung (apps/overlay/public/sprites/boss-anim/<tên>.png, 8 khung xếp ngang). */
export const BOSS_CLIPS = ['idle', 'walk', 'run', 'rage', 'scold', 'paper', 'desk', 'phone'] as const;
export type BossClip = (typeof BOSS_CLIPS)[number];
const CLIP_FPS: Record<BossClip, number> = { idle: 5, walk: 10, run: 14, rage: 8, scold: 8, paper: 7, desk: 8, phone: 7 };
/** Khung hoạt ảnh gốc cao ~136px → phóng cho bằng ảnh tư thế (~170px; Sếp vừa phải, không lấn nhân viên). */
const CLIP_SCALE = 1.25;
const CLIP_ANCHOR_X: Partial<Record<BossClip, number>> = { desk: 0.45 };
const isClip = (p: string): p is BossClip => (BOSS_CLIPS as readonly string[]).includes(p);

let clips: Partial<Record<BossClip, Texture[]>> = {};
export function setBossClips(c: Partial<Record<BossClip, Texture[]>>): void {
  clips = c;
}

/** Hoạt ảnh mặc định theo biểu cảm (nếu có); không có thì dùng ảnh tư thế MOOD_POSE. */
const MOOD_CLIP: Partial<Record<Expression, BossClip>> = { normal: 'idle', annoyed: 'idle', angry: 'rage', hit: 'rage' };

/**
 * Sếp trọc đầu, vẽ pixel art. Gốc toạ độ (0,0) là giữa hai bàn chân.
 * Chỉ vẽ lại đầu khi đổi biểu cảm; mỗi khung hình chỉ đổi vị trí → rất nhẹ.
 */
export class Boss extends Container {
  private body = new Graphics();
  private head = new Container();
  private headG = new Graphics();
  private sweat = new Graphics();
  private steam = new Graphics();
  private mood: Mood = 'normal';
  private expression: Expression | null = null;
  private t = 0;
  shakeAmount = 0;
  walking = false;
  leanAngle = 0;
  /** Chạy (dùng hoạt ảnh "run" thay cho "walk"). */
  running = false;
  /** Tư thế/hoạt ảnh ép buộc do hoạt ảnh hành động đặt (chỉ có tác dụng ở chế độ ảnh). */
  private pose: BossPose | BossClip | null = null;
  private sprite: Sprite | null = null;
  private shown: string | null = null;
  private clipStart = 0;
  private frame = -1;

  constructor() {
    super();
    if (Object.keys(sheet).length > 0 || Object.keys(clips).length > 0) {
      this.sprite = new Sprite();
      this.sprite.scale.set(SPRITE_SCALE);
      this.addChild(this.sprite);
      this.updateSprite();
      return;
    }
    drawGrid(this.body, BODY, { K: INK, S: SKIN.normal, B: 0x2d3142, W: 0xffffff, T: 0xc01c28, P: 0x23263a, O: 0x111111 }, PX, -W / 2, -BODY_H);
    this.head.y = -BODY_H + PX;
    // giọt mồ hôi
    this.sweat.rect(W / 2 - 4, -70, 8, 14).fill(0x62a0ea).rect(W / 2 - 8, -56, 14, 10).fill(0x62a0ea);
    this.sweat.rect(-W / 2 - 4, -60, 8, 14).fill(0x62a0ea).rect(-W / 2 - 8, -46, 14, 10).fill(0x62a0ea);
    // hơi nóng bốc lên đầu
    for (const [x, y, s] of [
      [-34, -104, 14],
      [-4, -114, 16],
      [26, -104, 14],
      [-18, -132, 10],
      [12, -136, 10]
    ] as const)
      this.steam.rect(x, y, s, s).fill({ color: 0xffffff, alpha: 0.9 });
    this.head.addChild(this.headG, this.sweat, this.steam);
    this.addChild(this.body, this.head);
    this.redraw();
  }

  setMood(m: Mood): void {
    if (m === this.mood) return;
    this.mood = m;
    this.redraw();
  }

  /** Biểu cảm tạm thời (ví dụ bị ném trúng); null = theo mood. */
  setExpression(e: Expression | null): void {
    if (e === this.expression) return;
    this.expression = e;
    this.redraw();
  }

  /** Ép một tư thế cụ thể (null = theo biểu cảm/mood). Không có ảnh thì quy về biểu cảm gần nhất. */
  setPose(p: BossPose | BossClip | null): void {
    this.pose = p;
    if (this.sprite) this.updateSprite();
  }

  /** Đang dùng ảnh (không phải hình vẽ dự phòng) — dùng để ẩn bàn vẽ sẵn khi ảnh đã có bàn. */
  get hasSprites(): boolean {
    return this.sprite !== null;
  }

  /** Chọn ảnh/hoạt ảnh cần hiện: ép buộc → đi/chạy → theo biểu cảm. */
  private choose(): BossPose | BossClip {
    if (this.pose && ((isClip(this.pose) && clips[this.pose]) || sheet[this.pose as BossPose])) return this.pose;
    if (this.walking) {
      const c: BossClip = this.running && clips.run ? 'run' : 'walk';
      if (clips[c]) return c;
      if (sheet.walking) return 'walking';
    }
    const e = this.expression ?? this.mood;
    const c = MOOD_CLIP[e];
    if (c && clips[c]) return c;
    const p = MOOD_POSE[e];
    if (sheet[p]) return p;
    return clips.idle ? 'idle' : 'cold';
  }

  private updateSprite(): void {
    const s = this.sprite!;
    const p = this.choose();
    const anim = isClip(p) && clips[p] ? clips[p] : null;
    if (p !== this.shown) {
      this.shown = p;
      this.clipStart = this.t;
      this.frame = -1;
      if (anim) {
        s.scale.set(CLIP_SCALE);
        s.anchor.set(CLIP_ANCHOR_X[p as BossClip] ?? 0.5, 1);
      } else {
        s.scale.set(SPRITE_SCALE);
        s.texture = sheet[p as BossPose]!;
        s.anchor.set(ANCHOR_X[p as BossPose] ?? 0.5, 1);
      }
    }
    if (anim) {
      const frames = anim;
      const f = Math.floor(((this.t - this.clipStart) / 1000) * CLIP_FPS[p as BossClip]) % frames.length;
      if (f !== this.frame) {
        this.frame = f;
        s.texture = frames[f]!;
      }
    }
  }

  tick(dtMs: number): void {
    if (!this.visible || this.alpha === 0) return;
    this.t += dtMs;
    const m = this.expression ?? this.mood;
    if (this.sprite) {
      this.updateSprite();
      const intensity = m === 'angry' ? 2 : m === 'panic' ? 3 : m === 'hit' ? 4 : 0;
      this.sprite.x = Math.round((intensity + this.shakeAmount) * Math.sin(this.t * 0.09));
      this.sprite.y = this.walking ? -Math.round(Math.abs(Math.sin(this.t * 0.02)) * 6) : 0;
      this.rotation = this.leanAngle;
      return;
    }
    const intensity = m === 'angry' ? 2 : m === 'panic' ? 4 : m === 'hit' ? 5 : 0;
    const shake = Math.round((intensity + this.shakeAmount) * Math.sin(this.t * 0.09));
    const step = this.walking ? -Math.round(Math.abs(Math.sin(this.t * 0.02)) * 8) : 0;
    this.body.position.set(shake, step);
    this.head.position.set(shake, -BODY_H + PX + step + (Math.sin(this.t * 0.004) > 0 ? 0 : 2));
    this.rotation = this.leanAngle;
    this.steam.visible = m === 'angry' || m === 'hit';
    if (this.steam.visible) this.steam.y = -(Math.floor(this.t / 120) % 4) * 4;
    this.sweat.visible = m === 'panic' || m === 'helpless' || m === 'shock';
    if (this.sweat.visible) this.sweat.y = (Math.floor(this.t / 100) % 4) * 4;
  }

  private redraw(): void {
    if (this.sprite) {
      this.updateSprite();
      return;
    }
    const m = this.expression ?? this.mood;
    const skin = SKIN[m === 'hit' ? 'angry' : m === 'shock' ? 'panic' : m];
    const g = this.headG.clear();
    const oy = -HEAD.length * PX;
    drawGrid(g, HEAD, { K: INK, S: skin, L: 0xfff4e6, H: 0x3b2f2f }, PX, -W / 2, oy);
    // p(cột, hàng, rộng, cao, màu) theo ô của lưới đầu
    const p = (c: number, r: number, w: number, h: number, color: number) =>
      g.rect(-W / 2 + c * PX, oy + r * PX, w * PX, h * PX).fill(color);
    const brown = 0x3b2f2f;
    const lip = 0x7a2e2e;
    // ria mép
    p(7, 8, 6, 0.7, brown);
    switch (m) {
      case 'normal':
        p(5, 5, 3, 0.5, brown);
        p(12, 5, 3, 0.5, brown);
        p(6, 6, 1, 1, INK);
        p(13, 6, 1, 1, INK);
        p(8, 9, 1, 0.5, lip);
        p(9, 9.4, 2, 0.5, lip);
        p(11, 9, 1, 0.5, lip);
        break;
      case 'annoyed':
        p(5, 5, 3, 0.5, brown);
        p(12, 4.6, 3, 0.5, brown);
        p(6, 6.3, 1, 0.7, INK);
        p(13, 6.3, 1, 0.7, INK);
        p(8, 9.3, 4, 0.5, lip);
        break;
      case 'angry':
      case 'hit':
        p(5, 4.4, 1, 0.6, brown);
        p(6, 4.8, 1, 0.6, brown);
        p(7, 5.2, 1, 0.6, brown);
        p(12, 5.2, 1, 0.6, brown);
        p(13, 4.8, 1, 0.6, brown);
        p(14, 4.4, 1, 0.6, brown);
        p(6, 6, 1, 1, INK);
        p(13, 6, 1, 1, INK);
        p(8, 9, 4, 1.4, lip);
        p(8, 9, 4, 0.5, 0xffffff);
        break;
      case 'panic':
      case 'shock':
        p(5, 3.8, 3, 0.5, brown);
        p(12, 3.8, 3, 0.5, brown);
        p(5, 5, 2, 2, 0xffffff);
        p(13, 5, 2, 2, 0xffffff);
        p(5.5, 5.5, 1, 1, INK);
        p(13.5, 5.5, 1, 1, INK);
        p(9, 9, 2, 1.6, lip);
        break;
      case 'helpless':
        p(5, 5.2, 3, 0.5, brown);
        p(12, 5.2, 3, 0.5, brown);
        p(5, 6.5, 2, 0.5, INK);
        p(13, 6.5, 2, 0.5, INK);
        p(8, 9.6, 1, 0.5, lip);
        p(9, 9.2, 2, 0.5, lip);
        p(11, 9.6, 1, 0.5, lip);
        break;
    }
  }
}

/** Có hoạt ảnh từng khung này không (để chọn cách diễn dự phòng). */
export function hasClip(c: BossClip): boolean {
  return !!clips[c];
}
