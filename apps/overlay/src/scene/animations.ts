import { Graphics, Sprite, Text, type Container } from 'pixi.js';
import type { RunningAction } from '@cau/shared';
import type { SceneRefs, Spot } from './contract';
import { bigFishTexture } from './assets';
import { seatedPullPoints } from './angler';
import { LAKE_SPOTS, SHIRTS } from './lake';
import { clamp01, easeIn, easeInOut, easeOut, lerp, seg } from './util';

/**
 * Mỗi hoạt ảnh là một timeline xác định theo thời gian: update(ms) vẽ đúng trạng thái tại thời điểm ms.
 * Nhờ vậy overlay mở giữa chừng vẫn vẽ đúng vị trí; finish() luôn đưa cảnh về trạng thái gốc.
 * Mọi hành động kéo cá đều dùng lane `king` + `lake` nên chỉ một hoạt ảnh chạy tại một thời điểm
 * → finish() được phép trả cả cảnh về gốc.
 *
 * Hành động = "kéo cá to": cần thủ của người tặng ra mép hồ, cá cắn câu, cần cong vút, dây căng rung,
 * nước xoáy, bọt tung, rung màn hình, cá phóng khỏi mặt nước xoay vòng, băng rôn tên + cân to giữa màn hình,
 * pháo hoa + tia sáng, cả hồ cổ vũ. Bậc càng cao (cá càng to) càng dài, càng hoành tráng.
 */
export interface ActionAnim {
  update(elapsedMs: number): void;
  finish(): void;
}

export type AnimFactory = (s: SceneRefs, run: RunningAction) => ActionAnim;

const INK = 0x1b1b24;
const TAU = Math.PI * 2;

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const label = (text: string, color = 0xe01b24, size = 44, strokeW = 8): Text => {
  const t = new Text({
    text,
    style: {
      fontFamily: 'Be Vietnam Pro, Segoe UI, Arial',
      fontSize: size,
      fontWeight: '900',
      fill: color,
      stroke: { color: 0xffffff, width: strokeW },
      align: 'center',
      // Dấu tiếng Việt trên chữ in hoa (É, Ô, Ặ...) nhô cao hơn cap height: dòng thưa + padding để không bị cắt.
      lineHeight: size * 1.4,
      padding: Math.ceil(size * 0.3)
    }
  });
  t.anchor.set(0.5);
  t.visible = false;
  return t;
};

/** Hiện chữ trong [a,b] với hiệu ứng "bật" lúc xuất hiện. */
function pop(t: Text, p: number, a: number, b: number, x: number, y: number, rise = 30, scale = 1): void {
  const on = p >= a && p < b;
  t.visible = on;
  if (!on) return;
  const k = seg(p, a, b);
  const sc = k < 0.1 ? lerp(0.3, 1.15, k / 0.1) : k < 0.18 ? lerp(1.15, 1, (k - 0.1) / 0.08) : 1;
  t.scale.set(sc * scale);
  t.position.set(x, y - rise * k);
  t.alpha = k > 0.88 ? 1 - (k - 0.88) / 0.12 : 1;
}

const short = (name: string, n = 16) => {
  const c = [...name];
  return c.length > n ? `${c.slice(0, n - 1).join('')}…` : name;
};

/** Chữ hiển thị không dùng từ ngữ may rủi (chính sách TikTok). */
const clean = (name: string) => name.replace(/\s*may mắn/gi, '').trim();
const fmtKg = (kg: number) => (Math.round(kg * 10) / 10).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/** Vòng elip bằng các vệt điểm ảnh bắt lưới 4px (cùng kiểu gợn nước trong ảnh nền, không dùng nét vector). */
function pixelRing(g: Graphics, x: number, y: number, rx: number, ry: number, color: number, alpha: number, dash = 8): void {
  const n = Math.max(12, Math.min(48, Math.round((rx + ry) * 0.16)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const px = Math.round((x + Math.cos(a) * rx) / 4) * 4;
    const py = Math.round((y + Math.sin(a) * ry) / 4) * 4;
    g.rect(px - dash / 2, py - 2, dash, 4).fill({ color, alpha });
  }
}

/** Gợn sóng hình elip lan ra. age 0..1. */
function ripple(g: Graphics, x: number, y: number, age: number, maxR: number, color = 0xffffff, width = 5): void {
  if (age <= 0 || age >= 1) return;
  const r = 10 + maxR * easeOut(age);
  pixelRing(g, x, y, r, r * 0.32, color, Math.ceil(0.9 * (1 - age) * 4) / 4, width + 4);
}

/** Tia nước bắn (giọt vuông kiểu pixel). age 0..1. */
function splash(g: Graphics, x: number, y: number, age: number, seed: number, n = 10, spread = 140, up = 260): void {
  if (age <= 0 || age >= 1) return;
  for (let i = 0; i < n; i++) {
    const r = hash(`${seed}:${i}`);
    const vx = ((r % 200) / 100 - 1) * spread;
    const vy = -up - ((r >> 5) % 200) * (up / 260);
    const t = age * 0.9;
    const px = x + vx * t;
    const py = y + vy * t + 900 * t * t;
    const sz = 8 + ((r >> 9) % 3) * 4;
    g.rect(px - sz / 2, py - sz / 2, sz, sz).fill({ color: i % 3 ? 0xbfe8ff : 0xffffff, alpha: 1 - age * 0.6 });
  }
}

/** Ngôi sao lấp lánh 4 cánh. */
function sparkle(g: Graphics, x: number, y: number, size: number, alpha: number, c = 0xfff3a0): void {
  const b = Math.max(3, size / 4);
  g.rect(x - b / 2, y - size, b, size * 2).fill({ color: c, alpha }).rect(x - size, y - b / 2, size * 2, b).fill({ color: c, alpha });
  g.rect(x - b, y - b, b * 2, b * 2).fill({ color: 0xffffff, alpha });
}

/** Chiếc tim pixel. */
function heart(g: Graphics, x: number, y: number, alpha: number, c = 0xff6b9a): void {
  g.rect(x, y, 8, 8).fill({ color: c, alpha }).rect(x + 12, y, 8, 8).fill({ color: c, alpha });
  g.rect(x - 4, y + 6, 28, 8).fill({ color: c, alpha }).rect(x + 4, y + 14, 12, 8).fill({ color: c, alpha });
}

/** Thêm các đối tượng vào một lớp; trả về hàm huỷ tất cả. */
function attach(layer: Container, ...items: Container[]): () => void {
  layer.addChild(...items);
  return () => items.forEach((i) => i.destroy());
}

/** Gọi reactAll chỉ khi đổi trạng thái (không gọi mỗi khung). */
function reactor(s: SceneRefs) {
  let cur: 'cheer' | 'wet' | 'scared' | 'pull' | null = null;
  return (k: typeof cur) => {
    if (k === cur) return;
    cur = k;
    s.anglers.reactAll(k);
  };
}

/** Bắn chớp đúng một lần khi đi qua mỗi mốc (mở giữa chừng không bắn dồn tia cũ). */
function flasher(s: SceneRefs, times: number[], dur: number) {
  let fired = 0;
  return (p: number) => {
    while (fired < times.length && p >= times[fired]!) {
      if ((p - times[fired]!) * dur < 300) s.weather.flash();
      fired++;
    }
  };
}

// ---------------------------------------------------------------------------
// Cá vẽ thủ tục theo loài (một lần, rồi chỉ dời / xoay / co giãn).
// Gốc (0,0) = tâm thân, đầu quay sang phải, dài L px.
// ---------------------------------------------------------------------------

type FishKind = 'koi' | 'carp' | 'grass' | 'catfish' | 'snakehead' | 'giant' | 'arowana' | 'stingray' | 'mystery';

const FISH_PAL: Record<FishKind, { body: number; belly: number; dark: number; fin: number }> = {
  koi: { body: 0xf6f5f4, belly: 0xffffff, dark: 0xe66100, fin: 0xffbe6f },
  carp: { body: 0xc8892b, belly: 0xf9e3a3, dark: 0x8f5b00, fin: 0xe5a50a },
  grass: { body: 0x8a9a5b, belly: 0xe9edc9, dark: 0x5b6b33, fin: 0xa3b18a },
  catfish: { body: 0x6b5a4a, belly: 0xd8c3a5, dark: 0x463a2f, fin: 0x8c7660 },
  snakehead: { body: 0x56634a, belly: 0xc9d1b3, dark: 0x2f3a27, fin: 0x7b8a63 },
  giant: { body: 0x5e6c7a, belly: 0xdfe6ec, dark: 0x3a4651, fin: 0x8696a5 },
  arowana: { body: 0xf5c211, belly: 0xfff3a0, dark: 0xc88800, fin: 0xff7800 },
  stingray: { body: 0x7a6a5a, belly: 0xf2e6d8, dark: 0x4a3e33, fin: 0x9c8a77 },
  mystery: { body: 0x3d5a80, belly: 0x98c1d9, dark: 0x293241, fin: 0x5c7ea6 }
};

function drawFish(g: Graphics, kind: FishKind, L: number): Graphics {
  const P = FISH_PAL[kind];
  if (kind === 'stingray') {
    const W = L * 0.5;
    // đuôi dài mảnh
    g.moveTo(-L * 0.3, 0).lineTo(-L * 0.95, L * 0.06).stroke({ width: 10, color: INK }).moveTo(-L * 0.3, 0).lineTo(-L * 0.95, L * 0.06).stroke({ width: 5, color: P.dark });
    const pts = [L * 0.42, 0, 0, -W, -L * 0.34, 0, 0, W];
    g.poly(pts.map((v, i) => v * 1.06 + (i % 2 ? 0 : 4))).fill(INK);
    g.poly(pts).fill(P.body);
    g.poly([L * 0.3, 0, 0, -W * 0.6, -L * 0.2, 0, 0, W * 0.6]).fill(P.dark);
    for (let i = 0; i < 9; i++) {
      const r = hash(`ray${i}`);
      g.rect(((r % 100) / 100 - 0.5) * L * 0.4, (((r >> 7) % 100) / 100 - 0.5) * W, 10, 10).fill(P.belly);
    }
    g.rect(L * 0.18, -W * 0.18, 12, 12).fill(0xffffff).rect(L * 0.21, -W * 0.16, 6, 6).fill(INK);
    g.rect(L * 0.18, W * 0.08, 12, 12).fill(0xffffff).rect(L * 0.21, W * 0.1, 6, 6).fill(INK);
    return g;
  }
  const slim = kind === 'arowana' || kind === 'snakehead' ? 0.28 : kind === 'catfish' || kind === 'giant' ? 0.32 : 0.4;
  const H = L * slim;
  const hl = L / 2;
  // đuôi
  const tail = [-hl + 8, 0, -hl - L * 0.24, -H * 0.62, -hl - L * 0.15, 0, -hl - L * 0.24, H * 0.62];
  g.poly(tail.map((v, i) => (i % 2 ? v * 1.15 : v - 5))).fill(INK);
  g.poly(tail).fill(P.fin);
  // vây lưng
  const dorsal = kind === 'arowana' || kind === 'snakehead' ? [L * 0.05, -H * 0.42, -L * 0.42, -H * 0.62, -L * 0.42, -H * 0.2] : [L * 0.12, -H * 0.45, -L * 0.12, -H * 0.85, -L * 0.25, -H * 0.38];
  g.poly(dorsal.map((v, i) => (i % 2 ? v - 4 : v))).fill(INK);
  g.poly(dorsal).fill(P.fin);
  // thân
  g.ellipse(0, 0, hl + 6, H / 2 + 6).fill(INK);
  g.ellipse(0, 0, hl, H / 2).fill(P.body);
  g.ellipse(L * 0.04, H * 0.2, L * 0.38, H * 0.22).fill(P.belly);
  // hoa văn
  if (kind === 'koi') {
    g.ellipse(-L * 0.1, -H * 0.1, L * 0.16, H * 0.24).fill(P.dark).ellipse(L * 0.22, -H * 0.18, L * 0.1, H * 0.16).fill(0xe01b24);
  } else if (kind === 'snakehead') {
    for (let i = 0; i < 5; i++) g.ellipse(-L * 0.32 + i * L * 0.14, -H * 0.05 + (i % 2) * H * 0.12, L * 0.05, H * 0.13).fill(P.dark);
  } else if (kind === 'arowana' || kind === 'carp' || kind === 'grass' || kind === 'mystery') {
    const step = Math.max(14, L / 12);
    for (let x = -hl + step; x < hl * 0.6; x += step)
      for (let y = -H * 0.32; y < H * 0.1; y += step * 0.8) g.rect(x + ((y / step) % 2) * 4, y, step * 0.5, 4).fill({ color: P.dark, alpha: 0.75 });
    if (kind === 'arowana') g.ellipse(-L * 0.05, -H * 0.12, L * 0.3, H * 0.1).fill({ color: 0xffffff, alpha: 0.45 });
  } else {
    g.rect(-hl * 0.8, -H * 0.12, L * 0.7, 5).fill({ color: P.dark, alpha: 0.6 });
  }
  // vây ngực
  g.poly([L * 0.12, H * 0.12, -L * 0.04, H * 0.5, L * 0.04, H * 0.14]).fill(P.fin);
  // mang + mắt
  g.rect(L * 0.24, -H * 0.3, 5, H * 0.55).fill({ color: P.dark, alpha: 0.8 });
  const e = Math.max(10, L * 0.06);
  g.rect(L * 0.33, -H * 0.2, e, e).fill(0xffffff).rect(L * 0.33 + e * 0.45, -H * 0.2 + e * 0.2, e * 0.5, e * 0.6).fill(INK);
  // râu (cá trê / cá lăng)
  if (kind === 'catfish' || kind === 'giant') {
    for (const [dy, dx2, dy2] of [
      [0.02, 0.62, -0.25],
      [0.1, 0.66, 0.35],
      [0.12, 0.55, 0.5]
    ] as const) {
      g.moveTo(hl - 4, H * dy).quadraticCurveTo(hl + L * 0.15, H * dy, hl + L * (dx2 - 0.4), H * dy2 + H * 0.4).stroke({ width: 5, color: INK });
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Bậc cá: độ hoành tráng tăng dần theo lvl (0..8).
// ---------------------------------------------------------------------------

interface Tier {
  lvl: number;
  kind: FishKind | 'king';
  len: number;
  fallback: { emoji: string; name: string; kg: number };
  /** Cả hồ cùng kéo (không có người đi riêng). */
  crowd?: boolean;
  /** Mở đầu bằng thông báo "CÁ TO XUẤT HIỆN!". */
  event?: boolean;
}

const TIERS: Record<string, Tier> = {
  pull_koi: { lvl: 0, kind: 'koi', len: 150, fallback: { emoji: '🎏', name: 'Cá Koi', kg: 3.5 } },
  pull_carp: { lvl: 1, kind: 'carp', len: 170, fallback: { emoji: '🐟', name: 'Cá chép to', kg: 4.5 } },
  pull_grass_carp: { lvl: 2, kind: 'grass', len: 200, fallback: { emoji: '🐠', name: 'Cá trắm cỏ', kg: 9 } },
  pull_catfish: { lvl: 3, kind: 'catfish', len: 230, fallback: { emoji: '🐡', name: 'Cá trê khổng lồ', kg: 15 } },
  pull_snakehead: { lvl: 4, kind: 'snakehead', len: 250, fallback: { emoji: '🐟', name: 'Cá lóc bông', kg: 20 } },
  big_fish_event: { lvl: 4, kind: 'mystery', len: 250, fallback: { emoji: '🐋', name: 'Cá to bí ẩn', kg: 18 }, event: true },
  pull_giant_catfish: { lvl: 5, kind: 'giant', len: 290, fallback: { emoji: '🦈', name: 'Cá lăng khủng', kg: 38 } },
  pull_arowana: { lvl: 6, kind: 'arowana', len: 320, fallback: { emoji: '🐉', name: 'Cá rồng vàng', kg: 55 } },
  pull_stingray: { lvl: 7, kind: 'stingray', len: 330, fallback: { emoji: '🦈', name: 'Cá đuối khổng lồ', kg: 90 } },
  pull_legend: { lvl: 8, kind: 'king', len: 0, fallback: { emoji: '👑', name: 'Cá Thần huyền thoại', kg: 220 } },
  grand_haul: { lvl: 8, kind: 'king', len: 0, fallback: { emoji: '👑', name: 'Cá Thần', kg: 300 }, crowd: true }
};

/** Hành động lạ (cấu hình thêm): đoán bậc theo cân nặng. */
function tierFor(run: RunningAction): Tier {
  const t = TIERS[run.actionId];
  if (t) return t;
  const kg = run.fish?.kg ?? 10;
  const order: [number, FishKind, number][] = [
    [5, 'carp', 170],
    [12, 'grass', 200],
    [20, 'catfish', 230],
    [30, 'snakehead', 250],
    [55, 'giant', 290],
    [90, 'arowana', 320],
    [Infinity, 'stingray', 330]
  ];
  const i = Math.max(0, order.findIndex(([m]) => kg < m));
  const [, kind, len] = order[i]!;
  return { lvl: i + 1, kind, len, fallback: { emoji: '🐟', name: run.actionName, kg } };
}

const MYSTERY: FishKind[] = ['carp', 'grass', 'catfish', 'snakehead', 'giant'];

/** Loài cá vẽ tay → id hành động có ảnh sprite tương ứng (assets.ts). */
const KIND_ACTION: Partial<Record<FishKind, string>> = {
  koi: 'pull_koi',
  carp: 'pull_carp',
  grass: 'pull_grass_carp',
  catfish: 'pull_catfish',
  snakehead: 'pull_snakehead',
  giant: 'pull_giant_catfish',
  arowana: 'pull_arowana',
  stingray: 'pull_stingray'
};

// ---------------------------------------------------------------------------
// Trạng thái gốc của cảnh — finish() luôn trả về đúng trạng thái này.
// ---------------------------------------------------------------------------

interface Base {
  rise: number;
  bellyUp: boolean;
  kAlpha: number;
  kScaleX: number;
  kScaleY: number;
  uKingX: number;
  uKingY: number;
}

function capture(s: SceneRefs): Base {
  return {
    rise: s.king.rise,
    bellyUp: s.king.bellyUp,
    kAlpha: s.king.alpha,
    kScaleX: s.king.scale.x,
    kScaleY: s.king.scale.y,
    uKingX: s.underwater.king.x,
    uKingY: s.underwater.king.y
  };
}

function restore(s: SceneRefs, b: Base): void {
  const k = s.king;
  k.position.set(LAKE_SPOTS.kingHome.x, LAKE_SPOTS.kingHome.y);
  k.scale.set(b.kScaleX, b.kScaleY);
  k.rise = b.rise;
  k.thrash = 0;
  k.spin = 0;
  k.whisker = 1;
  k.bellyUp = b.bellyUp;
  k.alpha = b.kAlpha;
  k.visible = false;
  k.setExpression(null);
  s.setShake(0);
  s.weather.setStorm(0);
  s.weather.setRain(false);
  s.floodgate.setOpen(0);
  s.floodgate.setFlood(0);
  const u = s.underwater;
  u.root.visible = false;
  u.king.position.set(b.uKingX, b.uKingY);
  u.king.thrash = 0;
  u.king.spin = 0;
  u.king.setExpression(null);
  s.boat.rock = 0;
  s.fade.visible = false;
  s.fade.alpha = 0;
  s.banner.visible = false;
  s.anglers.reactAll(null);
}

function showBanner(s: SceneRefs, on: boolean, text: string): void {
  s.banner.visible = on;
  if (on && s.bannerText.text !== text) s.bannerText.text = text;
}

// ---------------------------------------------------------------------------
// Cần thủ người tặng kéo cá TẠI CHỖ: đứng dậy ngay chỗ ngồi của mình (ẩn nhân vật ngồi, hiện người đứng cùng cỡ).
// Người chưa có chỗ ngồi thì một người đi vào từ mép dưới, đứng ở mép nước bờ gần.
// ---------------------------------------------------------------------------

function makeTrip(s: SceneRefs, run: RunningAction, spot: Spot | undefined, standX: number, standY: number) {
  const name = run.actor?.displayName ?? 'Cần thủ ẩn danh';
  const inPlace = !!spot?.member;
  const shirt = spot?.shirt ?? SHIRTS[hash(name) % Math.max(1, SHIRTS.length)] ?? 0x3584e4;
  const w = s.spawnWalker();
  w.setPerson(name, { shirt, official: spot?.member?.follower ?? false, seed: spot?.member?.platformId ?? name });
  w.visible = false;
  w.pose = 'idle';
  w.holding = 'none';
  /** Người đứng cao hơn người ngồi chút (người ngồi ≈ 68·s px, người đứng mặc định ≈ 130 px). */
  const sc = inPlace ? 0.72 * spot!.s : 1;
  w.scale.set(sc);
  /** Hướng ra mặt nước: bờ trái nhìn phải, bờ phải nhìn trái. */
  const dir: 1 | -1 = spot?.side === 'right' ? -1 : 1;
  const home = inPlace ? { x: spot!.x, y: spot!.y } : { x: standX, y: 1990 };
  /** Có ảnh cần thủ: không đứng dậy — người ngồi (ảnh) kéo luôn tại ghế, chỉ ẩn người đứng vẽ tay. */
  const seated = inPlace ? seatedPullPoints(spot!) : null;
  let away = false;
  const setAway = (v: boolean) => {
    if (!inPlace || seated || v === away) return;
    away = v;
    s.anglers.setAway(spot!, v);
  };
  return {
    w,
    name,
    inPlace,
    /** Kéo ngay tại ghế bằng ảnh người ngồi (không có người đứng vẽ tay). */
    seated: !!seated,
    sc,
    dir,
    /**
     * Tại chỗ: đứng ở chỗ ngồi trong [a,d). Không có chỗ: đi vào trong [a,b], đứng ở mép nước tới c, ra về trong [c,d].
     * Trả true khi đang đứng ở vị trí kéo.
     */
    move(p: number, a: number, b: number, c: number, d: number): boolean {
      const out = p >= a && p < d;
      w.visible = out && !seated;
      setAway(out);
      if (!out) return false;
      if (inPlace) {
        w.position.set(home.x, home.y);
        w.pose = 'idle';
        w.facing = dir;
        return p < c;
      }
      let k: number;
      if (p < b) {
        k = easeInOut(seg(p, a, b));
        w.pose = 'walk';
        w.facing = standX >= home.x ? 1 : -1;
      } else if (p < c) {
        k = 1;
        w.pose = 'idle';
      } else {
        k = 1 - easeInOut(seg(p, c, d));
        w.pose = 'walk';
        w.facing = home.x >= standX ? 1 : -1;
      }
      w.x = lerp(home.x, standX, k);
      w.y = lerp(home.y, standY, k);
      return p >= b && p < c;
    },
    hand() {
      if (seated) return seated.hand;
      return { x: w.x + w.facing * 38 * sc, y: w.y - 62 * sc };
    },
    headY() {
      if (seated) return seated.headY;
      return w.y - 140 * sc;
    },
    done() {
      setAway(false);
      s.removeWalker(w);
    }
  };
}

// ---------------------------------------------------------------------------
// Bộ máy kéo cá to dùng chung cho mọi bậc.
// ---------------------------------------------------------------------------

const KH = LAKE_SPOTS.kingHome;

function bigPull(s: SceneRefs, run: RunningAction, tier: Tier): ActionAnim {
  const base = capture(s);
  const dur = run.durationMs;
  const lvl = tier.lvl;
  const isKing = tier.kind === 'king';
  const crowd = !!tier.crowd;
  const seed = hash(run.runId);
  const fish = run.fish ?? tier.fallback;
  const fishName = clean(fish.name);
  const who = run.actor ? short(run.actor.displayName, 18) : 'Cả hồ';
  const headline = crowd
    ? `CẢ HỒ kéo được\n${fish.emoji} ${fishName}\n${fmtKg(fish.kg)}kg!`
    : `${who} kéo được\n${fish.emoji} ${fishName}\n${fmtKg(fish.kg)}kg!`;

  // ---- mốc thời gian (tỉ lệ) ----
  const legend = isKing && !crowd;
  const BITE = 0.1;
  const FIGHT = legend ? 0.3 : 0.18;
  const BURST = 0.6;
  const APEX = 0.7;
  const SHOW_END = 0.9;

  // ---- vị trí ----
  // Người tặng đang ngồi câu → kéo ngay tại chỗ: lưỡi câu ở gần phao của họ, cá phóng lên cạnh họ rồi rơi về chỗ họ.
  const spot = !crowd && run.actor ? s.anglers.spotOf(run.actor.displayName) : undefined;
  const inPlace = !!spot?.member;
  const side = spot ? (spot.x < 540 ? -1 : 1) : seed % 2 ? 1 : -1;
  const standX = 540 + side * 110;
  const standY = LAKE_SPOTS.shoreY + 14;
  const clampWaterY = (y: number) => Math.max(LAKE_SPOTS.waterTopY + 50, Math.min(LAKE_SPOTS.waterBottomY - 40, y));
  const F =
    crowd || (isKing && !inPlace)
      ? { x: KH.x, y: KH.y }
      : inPlace
        ? spot!.side === 'front'
          ? { x: spot!.rodTip.x, y: clampWaterY(spot!.rodTip.y + 80) }
          : { x: spot!.rodTip.x + (spot!.side === 'right' ? -60 : 60), y: clampWaterY(spot!.rodTip.y + 50) }
        : { x: 540 + side * 40, y: lerp(LAKE_SPOTS.shoreY - 30, KH.y, 0.5) };

  const trip = crowd ? null : makeTrip(s, run, spot, standX, standY);
  const spots = crowd ? s.anglers.occupied().slice(0, 80) : [];

  // ---- đồ hoạ ----
  const water = new Graphics(); // xoáy, gợn, bóng cá (dưới cần thủ)
  const rays = new Graphics();
  const rayLen = 380 + lvl * 50;
  const nRays = 10 + lvl * 2;
  for (let i = 0; i < nRays; i++) {
    const a0 = (i / nRays) * TAU;
    const a1 = a0 + (TAU / nRays) * 0.5;
    rays.poly([0, 0, Math.cos(a0) * rayLen, Math.sin(a0) * rayLen, Math.cos(a1) * rayLen, Math.sin(a1) * rayLen]).fill({ color: i % 2 ? 0xffffff : 0xffd166, alpha: 0.32 });
  }
  rays.circle(0, 0, 120 + lvl * 10).fill({ color: 0xfff3a0, alpha: 0.35 });
  rays.visible = false;
  const rodG = new Graphics(); // cần + dây
  const spray = new Graphics(); // bọt nước bắn trên mặt nước
  const fireworks = new Graphics();
  const kind: FishKind = tier.kind === 'king' ? 'mystery' : tier.kind === 'mystery' ? MYSTERY[seed % MYSTERY.length]! : tier.kind;
  // Ảnh sprite (nếu đã tải) ưu tiên hơn cá vẽ thủ tục; Cá Thần không có ảnh thì dùng chính s.king.
  const texId = isKing ? 'pull_legend' : tier.event || !TIERS[run.actionId] ? KIND_ACTION[kind] : run.actionId;
  const tex = texId ? bigFishTexture(texId) : null;
  const dispLen = tier.len || 440;
  let fishG: Container | null = null;
  let baseScale = 1;
  if (tex) {
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    baseScale = dispLen / Math.max(1, tex.width);
    fishG = sp;
  } else if (!isKing) fishG = drawFish(new Graphics(), kind, tier.len);
  if (fishG) fishG.visible = false;
  /** Cá Thần có ảnh sprite: s.king vẫn vật lộn dưới nước, tới lúc phóng lên thì đổi sang ảnh. */
  const kingSprite = isKing && !!fishG;
  // Đỉnh cú phóng: cả hồ kéo → giữa màn hình; kéo riêng → ngay phía trên chỗ lưỡi câu, cạnh người kéo.
  const showHalf = ((fishG ? dispLen : 300) * 1.2) / 2;
  const apex = crowd
    ? { x: 540, y: Math.max(640, Math.min(820, LAKE_SPOTS.waterTopY + 80)) }
    : {
        x: Math.max(showHalf + 30, Math.min(1050 - showHalf, F.x + (inPlace && spot!.side !== 'front' ? (spot!.side === 'right' ? -40 : 40) : 0))),
        y: Math.max(650, Math.min(1250, F.y - 230 - lvl * 12))
      };
  // Băng rôn + tia sáng + pháo hoa luôn ở giữa màn hình, tránh chỗ cá đang khoe.
  const bannerY = crowd ? Math.min(1180, apex.y + 300 + lvl * 8) : apex.y < 1000 ? 1180 : 820;
  rays.position.set(540, bannerY);
  const shadow = new Graphics();
  const hookText = label(tier.event ? 'CÁ TO XUẤT HIỆN!' : 'DÍNH CÁ TO!', 0xe01b24, 50 + lvl * 3);
  const pullText = label(crowd ? 'HÒ DÔ TA!' : 'KÉO!!!', 0xff6b35, 56 + lvl * 3);
  const big = label(headline, 0xffd166, 64 + lvl * 4, 12);
  big.style.stroke = { color: INK, width: 14 };
  big.style.dropShadow = { color: 0xb4471c, distance: 6, angle: Math.PI / 2, blur: 0, alpha: 1 };
  const killWater = attach(s.waterFx, water, shadow);
  // mũi tên vàng nhảy trên đầu người tặng (để biết ai trong hàng ghế vừa tặng quà)
  // vẽ bậc thang theo ô 4px + viền mực đều 4px (cùng kiểu điểm ảnh, không tam giác vector)
  const marker = new Graphics();
  for (const [grow, color] of [
    [4, INK],
    [0, 0xffd166]
  ] as const) {
    marker.rect(-12 - grow, -64 - grow, 24 + grow * 2, 32 + grow).fill(color);
    for (let i = 0; i < 8; i++) {
      const w = 56 - i * 8 + grow * 2;
      marker.rect(-w / 2, -32 + i * 4 - (i === 0 ? grow : 0), w, 4 + (i === 0 ? grow : 0)).fill(color);
    }
    if (grow) marker.rect(-6, 0, 12, 4).fill(color);
  }
  marker.rect(-8, -60, 6, 20).fill(0xfff3c4);
  marker.visible = false;
  const killFx = attach(s.fx, marker, rodG, spray, ...(fishG ? [fishG] : []));
  // chữ + tia sáng + pháo hoa: lớp không zoom → không bị phóng to tràn khỏi màn hình khi camera zoom vào người tặng
  const killScreen = attach(s.screenFx, rays, fireworks, hookText, pullText, big);

  // dưới đáy hồ (chỉ Cá Thần huyền thoại): cảnh cắt Cá Thần đớp mồi
  const uLine = new Graphics();
  const uText = label('Cá Thần đớp mồi!!', 0xffd166, 46);
  const killU = legend ? attach(s.underwater.fx, uLine, uText) : () => {};

  const react = reactor(s);
  const flashTimes = lvl >= 6 ? [FIGHT + 0.08, (FIGHT + BURST) / 2, BURST, BURST + 0.05] : lvl >= 4 ? [BURST] : [];
  const flash = flasher(s, flashTimes, dur);

  // pháo hoa: số chùm theo bậc, thời điểm + vị trí cố định theo runId
  const bursts = Array.from({ length: 2 + lvl * 2 }, (_, i) => {
    const r = hash(`${run.runId}:fw${i}`);
    return {
      t: APEX + ((r % 1000) / 1000) * (SHOW_END - APEX - 0.04),
      x: 140 + ((r >> 3) % 800),
      y: bannerY - 420 + ((r >> 7) % 480),
      c: [0xffd166, 0xe01b24, 0x26a269, 0x3584e4, 0xff6b9a, 0xffffff][(r >> 2) % 6]!,
      n: 18 + lvl * 2
    };
  });
  const turns = 1 + Math.floor(lvl / 2);
  /** Quà tặng của một người cụ thể (không phải cá to định kỳ / cả hồ) → camera zoom thẳng vào người tặng. */
  const camOn = !crowd && !tier.event && !!run.actor;
  const camZoom = Math.min(1.9, 1.6 + lvl * 0.04);
  const shakeMax = Math.min(1, 0.2 + lvl * 0.1);

  return {
    update(ms) {
      const p = clamp01(ms / dur);
      const fightK = seg(p, FIGHT, BURST);
      const fighting = p >= FIGHT && p < BURST;
      const k = s.king;
      if (isKing) k.visible = true;

      // ---------- thời tiết theo bậc ----------
      const sky = seg(p, BITE, FIGHT) * (1 - seg(p, SHOW_END, 0.98));
      s.weather.setStorm(lvl >= 8 ? sky : lvl >= 7 ? 0.7 * sky : lvl >= 6 ? 0.4 * sky * (1 - seg(p, APEX, SHOW_END)) : 0);
      s.weather.setRain(lvl >= 7 && p >= FIGHT && p < APEX + 0.05);
      if (lvl >= 8) s.floodgate.setFlood(0.6 * easeInOut(seg(p, FIGHT, BURST)) * (1 - easeInOut(seg(p, BURST, SHOW_END))));
      if (lvl >= 8) s.floodgate.setOpen(seg(p, FIGHT - 0.05, FIGHT) * (1 - seg(p, SHOW_END - 0.05, SHOW_END)));
      flash(p);

      // ---------- cảnh cắt đáy hồ (huyền thoại) ----------
      if (legend) {
        const fa = p < 0.1 ? 0 : p < 0.13 ? seg(p, 0.1, 0.13) : p < 0.16 ? 1 - seg(p, 0.13, 0.16) : p < 0.26 ? 0 : p < 0.28 ? seg(p, 0.26, 0.28) : 1 - seg(p, 0.28, 0.31);
        s.fade.visible = fa > 0;
        s.fade.alpha = fa;
        const under = p >= 0.13 && p < 0.28;
        s.underwater.root.visible = under;
        uLine.clear();
        if (under) {
          const uk = s.underwater.king;
          const bite = seg(p, 0.15, 0.2);
          const hx = uk.x + 160;
          const hy = lerp(-50, uk.y - 20, easeOut(seg(p, 0.13, 0.17)));
          uLine.moveTo(hx, -50).lineTo(hx, hy).stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
          uLine.rect(hx - 8, hy - 4, 16, 12).fill(0xd4a373);
          uk.setExpression(bite < 1 ? 'chomp' : 'shock');
          uk.thrash = bite >= 1 ? 1 : 0.2;
          uk.x = base.uKingX + (bite >= 1 ? Math.sin(ms / 50) * 12 : 0);
          pop(uText, p, 0.18, 0.28, uk.x, uk.y - 240, 10);
        } else uText.visible = false;
      }

      // ---------- cần thủ ----------
      let hand = { x: standX, y: standY - 112 };
      if (trip) {
        const atLake = trip.move(p, 0, inPlace ? 0 : BITE, SHOW_END + 0.01, 0.99);
        const w = trip.w;
        if (atLake) {
          w.facing = F.x >= w.x ? 1 : -1;
          if (fighting) {
            w.pose = 'pull';
            // giật lùi theo từng cú
            w.x -= w.facing * (10 + lvl * 2) * trip.sc * Math.abs(Math.sin(ms / (160 - lvl * 6)));
          } else if (p >= BURST) w.pose = 'cheer';
          else w.pose = 'idle';
        }
        hand = trip.hand();
      }

      // ---------- vị trí lưỡi câu / cá dưới nước ----------
      const dart = 30 + lvl * 14;
      const hook = {
        x: F.x + Math.sin(ms / (420 - lvl * 20)) * dart * fightK,
        y: F.y + Math.sin(ms / (300 - lvl * 12) + 1) * dart * 0.35 * fightK
      };

      // ---------- mặt nước: xoáy + gợn + bóng cá ----------
      water.clear();
      shadow.clear();
      const vortex = seg(p, FIGHT, FIGHT + 0.08) * (1 - seg(p, BURST + 0.02, APEX));
      if (vortex > 0) {
        const rings = 2 + Math.ceil(lvl / 2);
        for (let j = 0; j < rings; j++) {
          const R = 50 + j * (36 + lvl * 6);
          pixelRing(water, hook.x, hook.y + 20, R, R * 0.32, 0xdff6ff, 0.6 * vortex);
          for (let i = 0; i < 5; i++) {
            const a = ms / (220 + j * 70) + (i / 5) * TAU + j;
            water.rect(hook.x + Math.cos(a) * R - 6, hook.y + 20 + Math.sin(a) * R * 0.32 - 4, 12, 8).fill({ color: 0xffffff, alpha: vortex });
          }
        }
      }
      if (p >= BITE && p < FIGHT) for (let i = 0; i < 3; i++) ripple(water, F.x, F.y + 20, (ms / 700 + i / 3) % 1, 90 + lvl * 10);
      if (!isKing && p >= FIGHT - 0.04 && p < BURST) {
        // bóng tròn mép mềm dưới lưỡi câu (to theo bậc cá)
        const rx = Math.min(120, 46 + tier.len * 0.12);
        const a = seg(p, FIGHT - 0.04, FIGHT);
        for (let i = 0; i < 5; i++) {
          const k = 1 - i * 0.15;
          shadow.ellipse(hook.x, hook.y + 30, rx * k, rx * 0.62 * k).fill({ color: 0x07141c, alpha: (0.14 + i * 0.03) * a });
        }
      }

      // ---------- bọt nước + bong bóng ----------
      spray.clear();
      if (fighting) {
        const every = Math.max(260, 650 - lvl * 50);
        for (let j = 0; j < 3; j++) {
          const n = Math.floor(ms / every) - j;
          if (n < 0) continue;
          const age = (ms - n * every) / (every * 2.2);
          splash(spray, hook.x + ((hash(`${seed}:${n}`) % 80) - 40), hook.y, age, seed + n, 6 + lvl, 70 + lvl * 12, 160 + lvl * 25);
        }
        for (let i = 0; i < 5 + lvl; i++) {
          const kk = (ms / 900 + i / (5 + lvl)) % 1;
          const bx = hook.x + Math.sin(i * 2.7 + ms / 300) * (40 + lvl * 8);
          const by = hook.y + 30 - kk * 50;
          // bong bóng nước: ô vuông rỗng kiểu pixel
          const r = 4 + (i % 3) * 4;
          spray.rect(Math.round(bx / 4) * 4 - r, Math.round(by / 4) * 4 - r, r * 2, r * 2).stroke({ width: 4, color: 0xffffff, alpha: 1 - kk, alignment: 1 });
        }
      }
      // cú phóng khỏi mặt nước: bọt lớn
      splash(spray, F.x, F.y + 10, seg(p, BURST, BURST + 0.12), seed + 999, 14 + lvl * 3, 160 + lvl * 25, 380 + lvl * 40);
      ripple(spray, F.x, F.y + 30, seg(p, BURST, BURST + 0.14), 260 + lvl * 30, 0xffffff, 8);

      // ---------- cá phóng lên + xoay vòng → khoe giữa màn hình → về tay cần thủ / về hồ ----------
      const jump = seg(p, BURST, APEX);
      const show = p >= APEX && p < SHOW_END;
      const exit = seg(p, SHOW_END, 0.97);
      let fx = F.x;
      let fy = F.y;
      let rot = 0;
      let sc = 1;
      if (p >= BURST && p < APEX) {
        const j = easeOut(jump);
        fx = lerp(F.x, apex.x, j);
        fy = lerp(F.y, apex.y, j) - Math.sin(jump * Math.PI) * (120 + lvl * 15);
        rot = turns * TAU * easeOut(jump);
        sc = lerp(0.6, 1.15, j);
      } else if (show) {
        fx = apex.x;
        fy = apex.y + Math.sin(ms / 260) * 10;
        rot = Math.sin(ms / 180) * 0.12;
        sc = 1.15 + 0.05 * Math.sin(ms / 140);
      } else if (p >= SHOW_END) {
        const e = easeIn(exit);
        const tx = isKing ? KH.x : trip ? trip.w.x : apex.x;
        const ty = isKing ? KH.y : trip ? trip.w.y - 60 * trip.sc : apex.y;
        fx = lerp(apex.x, tx, e);
        fy = lerp(apex.y, ty, e) - Math.sin(exit * Math.PI) * 80;
        rot = isKing ? 0 : e * TAU;
        sc = lerp(1.15, isKing ? 1 : 0.35, e);
      }
      if (fishG) {
        fishG.visible = p >= BURST && exit < 1;
        fishG.position.set(fx, fy);
        fishG.rotation = rot;
        fishG.scale.set(sc * side * baseScale, sc * baseScale); // đầu quay về phía người kéo
        fishG.alpha = 1 - seg(exit, 0.8, 1);
      }
      if (kingSprite && p >= BURST) {
        // ảnh Cá Thần đang bay; s.king ẩn dưới hồ, hiện lại khi ảnh rơi về
        k.position.set(KH.x, KH.y);
        k.alpha = exit >= 1 ? base.kAlpha : 0;
        k.thrash = 0;
        k.spin = 0;
      } else if (isKing) {
        // Cá Thần: dùng chính s.king
        if (p < FIGHT) {
          // huyền thoại kéo tại chỗ: Cá Thần dời tới gần phao người kéo (trong lúc cảnh cắt đáy hồ che)
          const go = legend ? easeInOut(seg(p, 0.12, 0.28)) : 0;
          k.position.set(lerp(KH.x, F.x, go), lerp(KH.y, F.y, go));
          k.rise = lerp(base.rise, legend ? 0.2 : 0.4, seg(p, 0, FIGHT));
          k.thrash = 0;
          k.spin = 0;
          k.setExpression(legend && p > 0.12 ? 'chomp' : null);
        } else if (fighting) {
          const crowdDrag = crowd ? easeInOut(fightK) * 0.25 : 0;
          k.position.set(hook.x, lerp(hook.y, LAKE_SPOTS.shoreY - 60, crowdDrag));
          k.rise = 0.5 + 0.3 * fightK;
          k.thrash = 0.7 + 0.3 * Math.sin(ms / 90);
          k.spin = Math.sin(ms / 140) * 0.12;
          k.setExpression(fightK < 0.4 ? 'shock' : 'hit');
        } else {
          k.position.set(fx, fy);
          k.scale.set(base.kScaleX * sc, base.kScaleY * sc);
          k.rise = 1;
          k.spin = p < APEX ? rot : 0;
          k.thrash = show ? 0.25 : 0;
          k.setExpression(show ? 'dizzy' : p >= SHOW_END ? 'happy' : 'shock');
        }
      }
      // Cá Thần rơi về hồ: bọt lớn
      if (isKing) splash(spray, KH.x, KH.y + 10, seg(p, 0.97, 1), seed + 77, 16, 200, 300);

      // ---------- cần câu cong vút + dây căng rung ----------
      rodG.clear();
      const tension = fighting ? 0.6 + 0.4 * Math.abs(Math.sin(ms / 120)) : p >= BITE && p < FIGHT ? 0.25 : 0;
      const lineEnd = p < BURST ? hook : { x: fx, y: fy };
      const lineOn = p >= BITE && p < APEX + 0.02;
      // người ngồi kéo tại ghế: giấu cần thường của họ trong lúc vẽ cần cong (khỏi thấy hai cần)
      if (trip?.seated && spot) s.anglers.setRodHidden(spot, p >= BITE && p < SHOW_END);
      if (trip && p >= BITE && p < SHOW_END) {
        const L = 200 * trip.sc;
        const dirX = F.x >= hand.x ? 1 : -1;
        const t0 = { x: hand.x + dirX * L * 0.5, y: hand.y - L * 0.86 };
        const toward = Math.atan2(lineEnd.y - hand.y, lineEnd.x - hand.x);
        const bent = { x: hand.x + Math.cos(toward) * L * 0.75, y: hand.y + Math.sin(toward) * L * 0.75 };
        const bend = Math.min(1, tension * (0.6 + lvl * 0.06));
        const tip = { x: lerp(t0.x, bent.x, bend * 0.75), y: lerp(t0.y, bent.y, bend * 0.75) };
        const ctrl = { x: hand.x + (t0.x - hand.x) * 0.6, y: hand.y + (t0.y - hand.y) * 0.6 };
        rodG.moveTo(hand.x, hand.y).quadraticCurveTo(ctrl.x, ctrl.y, tip.x, tip.y).stroke({ width: Math.max(5, 11 * trip.sc), color: INK });
        rodG.moveTo(hand.x, hand.y).quadraticCurveTo(ctrl.x, ctrl.y, tip.x, tip.y).stroke({ width: Math.max(3, 6 * trip.sc), color: 0xc49a6c });
        rodG.rect(hand.x - 9, hand.y - 6, 18, 14).fill(INK).rect(hand.x - 6, hand.y - 3, 12, 8).fill(0x5e5c64);
        if (lineOn) drawLine(rodG, tip, lineEnd, tension, ms, lvl);
      }
      if (crowd && p >= BITE && p < APEX) {
        const mouth = p < BURST ? { x: k.x, y: k.y - 20 } : { x: fx, y: fy };
        for (const sp of spots) rodG.moveTo(sp.rodTip.x, sp.rodTip.y).lineTo(mouth.x, mouth.y);
        if (spots.length) rodG.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
        const anchor = { x: 540, y: LAKE_SPOTS.shoreY + 30 };
        drawLine(rodG, anchor, mouth, tension, ms, lvl, 9);
      }
      // phao lúc cá cắn câu
      if (p >= BITE && p < FIGHT && !legend) {
        const dip = Math.floor(ms / 180) % 2 ? 10 : 0;
        rodG.rect(F.x - 9, F.y - 18 + dip, 18, 24).fill(INK).rect(F.x - 6, F.y - 15 + dip, 12, 9).fill(0xe01b24).rect(F.x - 6, F.y - 6 + dip, 12, 9).fill(0xffffff);
      }

      // ---------- người xem quanh hồ + rung màn hình ----------
      if (crowd) {
        const beat = (ms % 900) / 900;
        s.anglers.pullAll(p >= BITE && p < BURST ? 0.35 + 0.65 * Math.max(0, Math.sin(beat * Math.PI)) : 0);
        react(p >= BITE && p < BURST ? 'pull' : p >= BURST && p < SHOW_END + 0.04 ? 'cheer' : null);
      } else {
        react(p >= FIGHT && p < BURST && lvl >= 7 ? 'scared' : p >= BURST && p < SHOW_END + 0.04 ? 'cheer' : null);
      }
      const shake = fighting ? shakeMax * (0.35 + 0.35 * fightK) : p >= BURST && p < BURST + 0.08 ? shakeMax : p >= BURST + 0.08 && p < APEX ? shakeMax * (1 - seg(p, BURST + 0.08, APEX)) : 0;
      s.setShake(shake);

      // ---------- tia sáng + pháo hoa ----------
      const raysOn = p >= APEX - 0.03 && p < SHOW_END + 0.02;
      rays.visible = raysOn;
      if (raysOn) {
        rays.rotation = ms / 1600;
        rays.alpha = seg(p, APEX - 0.03, APEX) * (1 - seg(p, SHOW_END - 0.02, SHOW_END + 0.02));
        rays.scale.set(0.9 + 0.08 * Math.sin(ms / 200));
      }
      fireworks.clear();
      for (const b of bursts) {
        const age = (p - b.t) * dur;
        if (age < -260 || age > 1100) continue;
        if (age < 0) {
          // vệt pháo bay lên
          const k2 = 1 + age / 260;
          fireworks.rect(b.x - 3, lerp(b.y + 400, b.y, k2), 6, 22).fill({ color: 0xfff3a0, alpha: 0.9 });
          continue;
        }
        const t = age / 1000;
        for (let i = 0; i < b.n; i++) {
          const a = (i / b.n) * TAU;
          const v = 260 + (i % 3) * 40;
          const x = b.x + Math.cos(a) * v * t;
          const y = b.y + Math.sin(a) * v * t + 260 * t * t;
          fireworks.rect(x - 4, y - 4, 8, 8).fill({ color: i % 4 ? b.c : 0xffffff, alpha: 1 - t * 0.85 });
        }
      }
      if (lvl === 0 && show) for (let i = 0; i < 6; i++) heart(fireworks, apex.x - 170 + i * 64, apex.y - 120 - ((ms / 1200 + i / 6) % 1) * 160, 1 - ((ms / 1200 + i / 6) % 1));
      if (show) for (let i = 0; i < 6 + lvl; i++) {
        const a = ms / 700 + (i / (6 + lvl)) * TAU;
        sparkle(fireworks, apex.x + Math.cos(a) * (tier.len * 0.7 + 90), apex.y + Math.sin(a) * 90, 10 + (i % 2) * 6, 0.9);
      }

      // ---------- camera ----------
      let zoomed = false;
      if (camOn) {
        const walking = !!trip && trip.w.visible;
        const headY = trip ? trip.headY() : spot ? spot.y - 80 * spot.s : 0;
        const me = walking ? { x: trip!.w.x, y: (headY + trip!.w.y) / 2 } : spot ? { x: spot.x, y: (headY + spot.y) / 2 } : null;
        marker.visible = !!me && p < BURST;
        s.anglers.spotlight(spot && p < SHOW_END ? spot : null);
        if (me) {
          marker.position.set(me.x, headY - 12 - Math.abs(Math.sin(ms / 180)) * 10);
          marker.scale.set(0.6);
        }
        if (me && p < SHOW_END) {
          zoomed = true;
          // người tặng nằm giữa vùng thấy được trên điện thoại (dưới HUD trên ≈ 560, trên khung bình luận ≈ 1540);
          // thông báo quà HTML giờ nằm ngay dưới khung hướng dẫn nên không cần đẩy người xuống thấp nữa
          if (p < BURST) s.camera.focus(run.runId, me.x, me.y, camZoom, 1060);
          // cá phóng lên: lùi ra một chút, nhìn cả người kéo lẫn con cá
          else s.camera.focus(run.runId, (me.x + apex.x) / 2, (me.y + apex.y) / 2, 1.3);
        } else s.camera.release(run.runId);
      }

      // ---------- băng rôn đầu ----------
      // Đang zoom vào người tặng: thông báo quà HTML đã có tên + quà → ẩn băng rôn cảnh cho khỏi trùng.
      const top = tier.event ? `🐋 CÁ TO XUẤT HIỆN!\n${who} đang kéo...` : `🎣 ${run.actionName.toUpperCase()}\n${who}`;
      showBanner(s, !zoomed && p < FIGHT + 0.06 && !(legend && p >= 0.13 && p < 0.29), top);

      // ---------- chữ ----------
      const wy = trip ? trip.headY() - 70 : LAKE_SPOTS.waterBottomY - 60;
      const wx = trip ? Math.max(150, Math.min(930, trip.w.x)) : 540;
      pop(hookText, p, BITE, FIGHT + 0.04, F.x, F.y - 150 - lvl * 6, 20);
      if (fighting) {
        const per = crowd ? 900 : Math.max(450, 800 - lvl * 40);
        const beat = (ms % per) / per;
        const n = Math.floor(ms / per);
        pullText.visible = beat < 0.65;
        pullText.position.set(wx + (n % 2 ? 90 : -90), wy - 30 * beat);
        pullText.scale.set(1 + 0.25 * (1 - beat));
        pullText.alpha = 1;
      } else pullText.visible = false;
      pop(big, p, APEX - 0.02, SHOW_END + 0.04, 540, bannerY, 0);
      if (big.visible && big.width > 1020) big.scale.set((big.scale.x * 1020) / big.width);
      // chữ bám theo người / lưỡi câu: đổi sang toạ độ màn hình rồi giữ trọn trong khung
      for (const tx of [hookText, pullText]) {
        if (!tx.visible) continue;
        const q = s.camera.toScreen(tx.x, tx.y);
        const hw = tx.width / 2 + 16;
        // HUD (hướng dẫn + bảng) kết thúc ở y ≤ 560: giữ cả chiều cao chữ ở dưới mép đó
        tx.position.set(Math.max(hw, Math.min(1080 - hw, q.x)), Math.max(575 + tx.height / 2, Math.min(1480, q.y)));
      }
    },
    finish() {
      trip?.done();
      if (trip?.seated && spot) s.anglers.setRodHidden(spot, false);
      killFx();
      killScreen();
      killWater();
      killU();
      if (crowd) s.anglers.pullAll(0);
      s.camera.release(run.runId);
      if (camOn) s.anglers.spotlight(null);
      restore(s, base);
    }
  };
}

/** Dây câu căng: võng nhẹ + rung theo lực căng. */
function drawLine(g: Graphics, a: { x: number; y: number }, b: { x: number; y: number }, tension: number, ms: number, lvl: number, width = 3): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const sag = 40 * (1 - tension);
  const vib = tension * (3 + lvl * 0.8) * Math.sin(ms / 22);
  g.moveTo(a.x, a.y);
  const N = 10;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const env = Math.sin(t * Math.PI);
    g.lineTo(a.x + dx * t + nx * vib * env, a.y + dy * t + ny * vib * env + sag * env);
  }
  g.stroke({ width, color: 0xffffff, alpha: 0.95 });
}

const pull: AnimFactory = (s, run) => bigPull(s, run, tierFor(run));

export const ANIMATIONS: Record<string, AnimFactory> = Object.fromEntries(Object.keys(TIERS).map((id) => [id, pull]));

/** Thời lượng mặc định (khớp cấu hình server) — dùng cho chế độ xem trước. */
export const PREVIEW_DURATIONS: Record<string, number> = {
  pull_carp: 5000,
  pull_grass_carp: 6000,
  pull_catfish: 7000,
  pull_snakehead: 7000,
  pull_giant_catfish: 8000,
  pull_arowana: 9000,
  pull_stingray: 10000,
  pull_legend: 12000,
  pull_koi: 5000,
  big_fish_event: 8000,
  grand_haul: 12000
};

export function createAnim(s: SceneRefs, run: RunningAction): ActionAnim {
  return (ANIMATIONS[run.actionId] ?? pull)(s, run);
}
