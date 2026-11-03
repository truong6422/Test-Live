import { Container, Graphics, GraphicsContext, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import type { Mood } from '@cau/shared';
import { AnglerField, bankEdge, FRONT, shirtFor, SHIRTS, TAG, useImageGeometry, Walker, WATER } from './angler';
import { lakeBackground } from './assets';
import type { LakeSpots, SceneRefs, Underwater, Weather } from './contract';
import { King } from './king';
import { block, hash, INK } from './pixel';
import { clamp01, lerp } from './util';

export { SHIRTS, TAG, shirtFor };

/*
 * Bố cục sân khấu 1080×1920 (dọc), hoàng hôn làng quê:
 *   0–560      trời (HUD trên phủ phần lớn)
 *   560–716    bờ xa: rặng tre, cây, cống xả; sàn tre "CHIẾU VIP" (người tặng quà nhiều / câu lâu nhất) ngồi nhìn ra người xem
 *   716–1460   mặt hồ; hai bờ trái/phải xiên nhẹ, cần thủ ngồi dọc mép nước (tối đa ~24 người mỗi bên)
 *   1460–1920  bờ gần: bãi cỏ (vùng giao diện TikTok che) — chỉ có đồ trang trí, người tặng quà đứng ở mép nước giữa
 * Phần tĩnh gộp thành texture (cacheAsTexture). Có ảnh public/bg/lake.png thì ảnh đó thay TOÀN BỘ phần tĩnh vẽ tay
 * (trời, bờ xa, hai bờ, nền nước, bờ gần, khung cống, sàn chiếu VIP + biển tên); chỉ giữ các lớp động
 * (lấp lánh/gợn sóng, thời tiết, bóng cá, cửa cống khi mở, thuyền, cần thủ, hiệu ứng).
 */

export const LAKE_SPOTS: LakeSpots = {
  waterTopY: WATER.top,
  waterBottomY: WATER.bottom,
  kingHome: { x: 540, y: 1080 },
  /** Mép nước bờ gần (giữa dưới): người tặng quà đứng đây kéo cá, sân khấu kéo cá là vùng nước giữa–dưới. */
  shoreY: WATER.bottom - 8,
  boatDock: { x: 420, y: 1420 },
  floodgate: { x: 850, y: 704 }
};

/** Đổi mọi mốc sang số đo trên ảnh nền (sửa tại chỗ để animations.ts giữ tham chiếu vẫn đúng). */
function fitToImage(): void {
  useImageGeometry();
  LAKE_SPOTS.waterTopY = WATER.top;
  LAKE_SPOTS.waterBottomY = WATER.bottom;
  LAKE_SPOTS.shoreY = WATER.bottom - 8;
  Object.assign(LAKE_SPOTS.kingHome, { x: 540, y: 1150 });
  // thuyền neo sát bờ gần, giữa hai khóm sen
  Object.assign(LAKE_SPOTS.boatDock, { x: 600, y: 1585 });
  // cống gỗ trên ảnh: khung x≈862–952, y≈615–720, cửa xả ngay mép nước góc trên phải
  Object.assign(LAKE_SPOTS.floodgate, { x: 906, y: 712 });
}

const label = (text: string, style: TextStyleOptions = {}) =>
  new Text({
    text,
    // lineHeight/padding rộng để dấu tiếng Việt trên chữ in hoa không bị cắt khi chữ nhiều dòng.
    style: { fontFamily: 'Segoe UI, Arial', fontSize: 26, fontWeight: '900', fill: 0xffffff, padding: 10, ...style, lineHeight: Math.round(((style.fontSize as number) ?? 26) * 1.4) }
  });

// ---------------------------------------------------------------------------
// Nền tĩnh vẽ tay
// ---------------------------------------------------------------------------
const SKY: [number, number][] = [
  [0, 0x2a1f4a],
  [150, 0x3b2858],
  [250, 0x573566],
  [330, 0x7a4268],
  [400, 0xa45266],
  [460, 0xcc6858],
  [510, 0xe8874e],
  [560, 0xf4a85a],
  [610, 0xffcf7a]
];
const WATER_BANDS: [number, number][] = [
  [WATER.top, 0xe9a66e],
  [WATER.top + 20, 0xb98a78],
  [WATER.top + 50, 0x7d8a96],
  [WATER.top + 110, 0x5a8597],
  [WATER.top + 220, 0x46798e],
  [WATER.top + 380, 0x376b80],
  [WATER.top + 560, 0x2d5f74]
];
const GRASS = 0x5f8f3a;
const GRASS_DARK = 0x4a7430;
const GRASS_LIGHT = 0x77a84a;
const MUD = 0x7a5a3a;

function bands(g: Graphics, list: [number, number][], bottom: number): void {
  list.forEach(([y, c], i) => {
    const next = list[i + 1]?.[0] ?? bottom;
    g.rect(0, y, 1080, next - y).fill(c);
    // viền răng cưa giữa hai dải màu (kiểu dither pixel)
    const nc = list[i + 1]?.[1];
    if (nc !== undefined) for (let x = (i % 2) * 8; x < 1080; x += 16) g.rect(x, next - 4, 8, 4).fill(nc);
  });
}

function pixelDisc(g: Graphics, cx: number, cy: number, r: number, color: number, step = 6): void {
  for (let dy = -r; dy <= r; dy += step) {
    const hw = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)) / step) * step;
    g.rect(cx - hw, cy + dy, hw * 2, step).fill(color);
  }
}

function bamboo(g: Graphics, x: number, base: number, h: number, seed: number): void {
  for (let i = 0; i < 5; i++) {
    const sx = x + (i - 2) * 10 + ((seed >> i) % 3) * 2;
    const sh = h - ((seed >> (i + 2)) % 4) * 18;
    g.rect(sx, base - sh, 5, sh).fill(0x3f6a2a).rect(sx + 1, base - sh, 2, sh).fill(0x5c8a36);
    for (let y = base - sh + 14; y < base; y += 22) g.rect(sx - 1, y, 7, 2).fill(0x2c4a1e);
    // lá tre
    for (let k = 0; k < 4; k++) {
      const ly = base - sh + k * 16;
      const dir = (k + i) % 2 ? 1 : -1;
      g.rect(sx + dir * 6, ly, 14 * dir, 4).fill(0x3d7a2c).rect(sx + dir * 14, ly + 4, 10 * dir, 3).fill(0x2f5f22);
    }
  }
}

function tree(g: Graphics, x: number, base: number, r: number): void {
  g.rect(x - 6, base - r, 12, r).fill(0x4a3424);
  pixelDisc(g, x, base - r - r * 0.4, r, 0x2f5a2c, 8);
  pixelDisc(g, x - r * 0.3, base - r - r * 0.6, r * 0.55, 0x3d7036, 8);
}

function drawSkyAndFarShore(g: Graphics): void {
  bands(g, SKY, 700);
  // mặt trời lặn sau rặng tre
  pixelDisc(g, 300, 612, 78, 0xffd27a);
  pixelDisc(g, 300, 612, 62, 0xfff0b0);
  // mây hồng dẹt
  for (const [x, y, w] of [
    [60, 470, 220],
    [640, 440, 260],
    [420, 520, 180],
    [820, 540, 200]
  ] as const) {
    g.rect(x, y, w, 10).fill(0xf7a8a0).rect(x + 30, y - 8, w - 70, 8).fill(0xf9bdb0).rect(x + 12, y + 10, w - 40, 4).fill(0xd98a88);
  }
  // chim bay
  for (const [x, y] of [
    [520, 480],
    [548, 470],
    [575, 486],
    [760, 500]
  ] as const)
    g.rect(x, y, 6, 3).fill(INK).rect(x + 6, y + 3, 4, 3).fill(INK).rect(x + 10, y, 6, 3).fill(INK);
  // đồi xa
  g.poly([0, 640, 0, 600, 120, 584, 260, 606, 380, 580, 520, 600, 660, 576, 820, 598, 960, 582, 1080, 596, 1080, 640]).fill(0x5a4466);
  // rặng cây + tre bờ xa
  g.rect(0, 640, 1080, 64).fill(0x2f4a33);
  for (let x = 0; x < 1080; x += 24) {
    const h = 10 + (hash(`t${x}`) % 4) * 8;
    g.rect(x, 640 - h, 24, h).fill(0x2f4a33);
  }
  for (const [x, h] of [
    [70, 150],
    [960, 160],
    [1030, 130],
    [420, 110],
    [660, 120]
  ] as const)
    bamboo(g, x, 660, h, hash(`b${x}`));
  tree(g, 170, 650, 46);
  tree(g, 560, 646, 36);
  tree(g, 800, 650, 42);
  // nhà sàn mái rạ
  block(g, 92, 600, 80, 40, 0x8a5a3b, INK, 3);
  g.poly([80, 602, 132, 566, 184, 602]).fill(INK).poly([88, 600, 132, 572, 176, 600]).fill(0xd9b45a);
  g.rect(124, 614, 16, 26).fill(0x3a2a1c).rect(100, 640, 4, 18).fill(INK).rect(160, 640, 4, 18).fill(INK);
  // mép đất bờ xa
  g.rect(0, 700, 1080, WATER.top - 700).fill(MUD);
  for (let x = 4; x < 1080; x += 30) g.rect(x, 700, 10, 4).fill(0x5a3f2e);
}

function drawWater(g: Graphics): void {
  bands(g, WATER_BANDS, WATER.bottom);
  // vệt phản chiếu mặt trời
  for (let y = WATER.top + 6, i = 0; y < WATER.top + 330; y += 12, i++) {
    const w = Math.max(10, 90 - i * 3) * (i % 2 ? 0.7 : 1);
    g.rect(300 - w / 2 + ((i * 13) % 9) - 4, y, w, 4).fill({ color: 0xffe0a0, alpha: Math.max(0.15, 0.8 - i * 0.025) });
  }
  // lá sen sát bờ
  for (const [x, y] of [
    [300, 1300],
    [330, 1330],
    [760, 900],
    [790, 1250],
    [300, 860]
  ] as const) {
    g.rect(x - 14, y - 6, 28, 12).fill(0x3d7a2c).rect(x - 10, y - 9, 20, 3).fill(0x4f9236).rect(x, y - 6, 3, 6).fill(0x2d5a20);
  }
}

function drawBanks(g: Graphics): void {
  // hai bờ trái/phải (xiên) + bờ gần, vẽ theo từng dải 8px
  for (let y = 700; y < 1920; y += 8) {
    if (y >= WATER.bottom) {
      g.rect(0, y, 1080, 8).fill(GRASS);
      continue;
    }
    const w = hash(`e${y >> 4}`) % 3;
    const xl = Math.round(bankEdge('left', y)) + w * 2 - 2;
    const xr = Math.round(bankEdge('right', y)) - w * 2 + 2;
    g.rect(0, y, xl, 8).fill(GRASS).rect(xl - 8, y, 8, 8).fill(GRASS_DARK).rect(xl, y, 5, 8).fill(MUD);
    g.rect(xr, y, 1080 - xr, 8).fill(GRASS).rect(xr, y, 8, 8).fill(GRASS_DARK).rect(xr - 5, y, 5, 8).fill(MUD);
  }
  // mép bờ gần
  const x0 = bankEdge('left', WATER.bottom);
  const x1 = bankEdge('right', WATER.bottom);
  g.rect(x0, WATER.bottom - 4, x1 - x0, 10).fill(MUD).rect(x0, WATER.bottom + 6, x1 - x0, 6).fill(GRASS_DARK);
  // đốm cỏ
  for (let i = 0; i < 260; i++) {
    const h = hash(`g${i}`);
    const y = 720 + (h % 1200);
    const x = hash(`gx${i}*7`) % 1080;
    const onWater = y < WATER.bottom && x > bankEdge('left', y) - 4 && x < bankEdge('right', y) + 4;
    if (onWater) continue;
    g.rect(x, y, 8, 4).fill(i % 3 ? GRASS_LIGHT : GRASS_DARK).rect(x + 2, y - 4, 3, 4).fill(GRASS_LIGHT);
  }
  // lau sậy sát mép nước
  for (let i = 0; i < 34; i++) {
    const h = hash(`r${i}`);
    const left = i % 2 === 0;
    const y = 740 + (h % 720);
    const x = bankEdge(left ? 'left' : 'right', y) + (left ? -6 : 2);
    for (let k = 0; k < 3; k++) g.rect(x + k * 4, y - 18 - k * 6, 3, 18 + k * 6).fill(k % 2 ? 0x8aa04a : 0x6f8a3a);
    g.rect(x + 3, y - 34, 4, 10).fill(0x8a5a3b);
  }
  // bờ gần: hoa dại, đá, xô cá, cần dự phòng
  for (let i = 0; i < 40; i++) {
    const h = hash(`f${i}`);
    const x = 20 + (h % 1040);
    const y = WATER.bottom + 30 + (hash(`fy${i}*3`) % 420);
    g.rect(x, y, 6, 6).fill([0xf6f5f4, 0xf5c211, 0xe66b8a][i % 3]!).rect(x + 2, y + 6, 2, 6).fill(GRASS_DARK);
  }
  // bụi cỏ lau thấp rải đều bờ gần (vùng giao diện TikTok che nên chỉ trang trí nhẹ)
  for (let i = 0; i < 22; i++) {
    const h = hash(`t${i}`);
    const x = 30 + (h % 1020);
    const y = WATER.bottom + 60 + (hash(`ty${i}*5`) % 380);
    for (let k = 0; k < 4; k++) g.rect(x + k * 5, y - 10 - (k % 2) * 8, 3, 10 + (k % 2) * 8).fill(k % 2 ? GRASS_LIGHT : GRASS_DARK);
  }
}

/** Sàn tre "CHIẾU VIP" trên bờ xa (chỉ vẽ khi không có ảnh nền). */
function drawVipDeck(g: Graphics): void {
  const x0 = FRONT.x0 - 18;
  const x1 = FRONT.x1 + 18;
  const top = FRONT.deckTop;
  const bot = FRONT.deckBottom;
  // cọc tre chống sàn (chân cắm xuống nước)
  for (let x = x0 + 10; x < x1; x += 60) g.rect(x, bot - 6, 8, 22).fill(INK).rect(x + 2, bot - 6, 4, 20).fill(0xb08a40);
  // mặt sàn tre
  block(g, x0, top, x1 - x0, bot - top - 14, 0xd9b45a, INK, 4);
  for (let x = x0 + 6; x < x1; x += 14) g.rect(x, top, 3, bot - top - 14).fill(0xc49a44);
  // chiếu đỏ viền vàng
  const m = 10;
  block(g, x0 + m, top + 10, x1 - x0 - 2 * m, bot - top - 34, 0xb8323a, 0xf5c211, 3);
  for (let x = x0 + m + 12; x < x1 - m - 12; x += 24) g.rect(x, top + 22, 8, 8).fill(0xf5c211).rect(x + 2, top + 24, 4, 4).fill(0xb8323a);
  // mép trước sàn (bó tre)
  g.rect(x0 - 4, bot - 18, x1 - x0 + 8, 12).fill(INK).rect(x0, bot - 16, x1 - x0, 8).fill(0xb08a40);
  for (let x = x0; x < x1; x += 22) g.rect(x, bot - 16, 2, 8).fill(0x7a5a2a);
  // cột đèn lồng hai đầu
  for (const x of [x0 - 2, x1 - 6]) {
    g.rect(x, top - 70, 8, 70).fill(INK).rect(x + 2, top - 68, 4, 68).fill(0x8a5a3b);
  }
  // biển tên
  g.rect(x0 + 30, top - 30, 4, 30).fill(INK).rect(x0 + 124, top - 30, 4, 30).fill(INK);
  block(g, x0 + 22, top - 58, 114, 32, 0x6b4a2a, INK, 3);
}

// ---------------------------------------------------------------------------
// Thuyền nan
// ---------------------------------------------------------------------------
function buildBoat(): Container {
  const root = new Container();
  const g = new Graphics();
  g.rect(-92, 8, 184, 8).fill({ color: 0x000000, alpha: 0.25 });
  g.poly([-96, -14, 96, -14, 76, 12, -76, 12]).fill(INK);
  g.poly([-88, -10, 88, -10, 70, 8, -70, 8]).fill(0x6b4a2a);
  for (let x = -80; x < 80; x += 10) g.rect(x, -10, 5, 16).fill(0x8a6a3a);
  g.rect(-90, -14, 180, 4).fill(0xb08a50);
  // sào tre nằm ngang
  g.rect(-110, -22, 210, 4).fill(INK).rect(-108, -21, 206, 2).fill(0xc9a55a);
  root.addChild(g);
  return root;
}

// ---------------------------------------------------------------------------
// Bóng cá to lượn dưới mặt hồ
// ---------------------------------------------------------------------------
function buildShadow(): { root: Container; g: Graphics; rings: Graphics[] } {
  const root = new Container();
  const g = new Graphics();
  for (let dy = -36; dy <= 36; dy += 6) {
    const hw = Math.round((110 * Math.sqrt(1 - (dy / 40) ** 2)) / 6) * 6;
    g.rect(-hw, dy, hw * 2, 6).fill(0x0b1f2a);
  }
  g.poly([96, 0, 170, -40, 156, 0, 170, 40]).fill(0x0b1f2a);
  g.poly([-10, -30, 30, -58, 40, -30]).fill(0x0b1f2a);
  g.alpha = 0.42;
  const ring = new GraphicsContext();
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    ring.rect(Math.round(Math.cos(a) * 70) - 4, Math.round(Math.sin(a) * 16) - 1, 8, 3).fill({ color: 0xe6f6ff, alpha: 0.85 });
  }
  const rings = [new Graphics(ring), new Graphics(ring), new Graphics(ring)];
  root.addChild(g, ...rings);
  root.visible = false;
  root.alpha = 0;
  return { root, g, rings };
}

// ---------------------------------------------------------------------------
// Đáy hồ (cảnh cắt)
// ---------------------------------------------------------------------------
function buildUnderwater(): Underwater & { tick(dt: number): void } {
  const root = new Container();
  root.visible = false;
  const bg = new Container();
  const g = new Graphics();
  bands(
    g,
    [
      [0, 0x2a8a9a],
      [300, 0x1f7686],
      [600, 0x176274],
      [900, 0x104e60],
      [1200, 0x0b3d4e],
      [1500, 0x082f3d]
    ],
    1920
  );
  // tia sáng chiếu xuống
  for (const [x, w] of [
    [160, 90],
    [420, 120],
    [760, 80],
    [940, 110]
  ] as const)
    g.poly([x, 0, x + w, 0, x + w * 2.2, 1500, x + w * 1.2, 1500]).fill({ color: 0xffffff, alpha: 0.06 });
  // đáy cát + đá + rác
  g.poly([0, 1500, 200, 1460, 420, 1490, 640, 1450, 860, 1480, 1080, 1460, 1080, 1920, 0, 1920]).fill(0xc9a86a);
  for (let i = 0; i < 120; i++) {
    const h = hash(`s${i}`);
    g.rect(h % 1080, 1500 + ((h >> 8) % 420), 6, 4).fill(i % 2 ? 0xb08f58 : 0xdcc08a);
  }
  for (const [x, y, w] of [
    [90, 1480, 120],
    [820, 1470, 150],
    [520, 1540, 70]
  ] as const)
    block(g, x, y, w, w * 0.45, 0x5e6a70, INK, 4).rect(x + 10, y + 6, w * 0.4, 6).fill(0x7c8a90);
  // chiếc ủng rách + mỏ neo
  block(g, 330, 1500, 30, 50, 0x3d2a1c, INK, 3);
  block(g, 330, 1536, 56, 18, 0x3d2a1c, INK, 3);
  g.rect(690, 1420, 8, 90).fill(0x5e5c64).rect(664, 1500, 60, 8).fill(0x5e5c64).rect(664, 1484, 8, 20).fill(0x5e5c64).rect(716, 1484, 8, 20).fill(0x5e5c64);
  const title = label('ĐÁY HỒ', { fontSize: 30, fill: 0xbfeaf2, stroke: { color: INK, width: 5 } });
  title.anchor.set(0.5);
  title.position.set(540, 640);
  bg.addChild(g, title);
  bg.cacheAsTexture(true);
  root.addChild(bg);

  // rong rêu đung đưa
  const weeds: Container[] = [];
  for (let i = 0; i < 12; i++) {
    const h = hash(`w${i}`);
    const c = new Container();
    const wg = new Graphics();
    const len = 120 + (h % 5) * 40;
    for (let y = 0; y < len; y += 12) {
      const off = Math.round(Math.sin(y * 0.05 + i) * 6);
      wg.rect(-5 + off, -y - 12, 10, 12).fill(INK).rect(-3 + off, -y - 12, 6, 12).fill(i % 2 ? 0x2f8a3a : 0x3fa04a);
      if ((y / 12) % 3 === 1) wg.rect(off + 3, -y - 8, 12, 5).fill(0x3fa04a);
    }
    c.addChild(wg);
    c.position.set(40 + ((i * 89 + (h % 40)) % 1000), 1490 + (h % 30));
    weeds.push(c);
    root.addChild(c);
  }

  const king = new King({ submerged: false });
  king.scale.set(1.8);
  king.position.set(580, 1060);
  const diver = new Walker(1.5);
  diver.pose = 'swim';
  diver.holding = 'goggles';
  diver.visible = false;
  const bubbles = new Graphics();
  const fx = new Container();
  root.addChild(king, diver, bubbles, fx);

  let t = 0;
  return {
    root,
    king,
    diver,
    fx,
    tick(dt) {
      t += dt;
      weeds.forEach((w, i) => (w.rotation = Math.sin(t * 0.0015 + i) * 0.12));
      bubbles.clear();
      for (let i = 0; i < 28; i++) {
        const h = hash(`u${i}`);
        const speed = 0.05 + (h % 5) * 0.02;
        const y = 1500 - ((t * speed + h) % 1500);
        const x = (h >> 4) % 1080 + Math.sin(t * 0.003 + i) * 8;
        const sz = 4 + (h % 3) * 3;
        bubbles.rect(x, y, sz, sz).stroke({ width: 2, color: 0xd8f4ff, alpha: 0.8 });
      }
      king.tick(dt);
      if (diver.visible) diver.tick(dt);
    }
  };
}

// ---------------------------------------------------------------------------
// Dựng toàn cảnh
// ---------------------------------------------------------------------------
export function buildLake(): SceneRefs {
  const root = new Container();
  const lake = new Container();
  root.addChild(lake);

  // ----- Nền tĩnh: ảnh nền nếu có, không thì vẽ tay (1 texture) -----
  const bg = new Container();
  const photo = lakeBackground();
  if (photo) fitToImage();
  if (photo) {
    const sp = new Sprite(photo);
    sp.width = 1080;
    sp.height = 1920;
    bg.addChild(sp);
  } else {
    const sky = new Graphics();
    drawSkyAndFarShore(sky);
    const water = new Graphics();
    drawWater(water);
    const banks = new Graphics();
    drawBanks(banks);
    bg.addChild(sky, water, banks);
  }
  // cống xả (khung) + sàn chiếu VIP: chỉ vẽ khi không có ảnh nền (ảnh nền đã có sẵn)
  const gate = LAKE_SPOTS.floodgate;
  const props = new Graphics();
  props.visible = !photo;
  block(props, gate.x - 52, gate.y - 76, 104, 72, 0x9a9996, INK, 4);
  props.rect(gate.x - 52, gate.y - 76, 104, 8).fill(0xb8b6b2);
  props.rect(gate.x - 34, gate.y - 60, 68, 56).fill(0x1f2a30);
  drawVipDeck(props);
  const vipSign = label('CHIẾU VIP', { fontSize: 19, fill: 0xffd166 });
  vipSign.anchor.set(0.5);
  vipSign.position.set(FRONT.x0 - 18 + 79, FRONT.deckTop - 42);
  const gateSign = label('CỐNG', { fontSize: 14, fill: INK });
  gateSign.anchor.set(0.5);
  gateSign.position.set(gate.x, gate.y - 72);
  gateSign.visible = !photo;
  if (photo) {
    // nhãn nhỏ phía trên sàn tre của ảnh
    // trên đầu các VIP (người ngồi cao ≈ 68·scale, nón thêm chút), luôn dưới dải HUD trên (kết thúc ≈ y 560)
    vipSign.style.fontSize = 24;
    vipSign.style.stroke = { color: INK, width: 5 };
    // ảnh cần thủ cao 84 đơn vị (gồm nón) → nhãn nằm hẳn trên đỉnh nón
    vipSign.position.set(540, Math.min(578, FRONT.feetY - 84 * (FRONT.scale || 1) - 24));
  }
  bg.addChild(props, vipSign, gateSign);
  lake.addChild(bg);

  // mây giông (phủ dần khi gọi bão)
  const stormClouds = new Graphics();
  for (let i = 0; i < 14; i++) {
    const h = hash(`c${i}`);
    const x = (i * 83 + (h % 60)) % 1100 - 40;
    const y = 470 + (h % 140);
    const w = 160 + (h % 4) * 40;
    stormClouds.rect(x, y, w, 30).fill(0x2a2d3a).rect(x + 24, y - 20, w - 60, 20).fill(0x353848).rect(x + 10, y + 30, w - 30, 8).fill(0x1f2230);
  }
  stormClouds.alpha = 0;
  stormClouds.visible = false;
  lake.addChild(stormClouds);

  // cửa cống + dòng nước xả
  const gateDoor = new Graphics();
  block(gateDoor, gate.x - 32, gate.y - 58, 64, 52, 0x6b5a3a, INK, 3);
  for (let y = gate.y - 50; y < gate.y - 8; y += 12) gateDoor.rect(gate.x - 30, y, 60, 3).fill(0x4f4028);
  // có ảnh nền: cửa cống chỉ hiện khi đang mở
  gateDoor.visible = !photo;
  const stream = new Graphics();
  stream.visible = false;
  lake.addChild(stream, gateDoor);

  // lấp lánh / gợn sóng mặt nước (vẽ lại cách khung)
  const waterAnim = new Graphics();
  lake.addChild(waterAnim);
  const sparkles = Array.from({ length: 56 }, (_, i) => {
    const h = hash(`sp${i}`);
    const y = WATER.top + 20 + (h % (WATER.bottom - WATER.top - 40));
    const x0 = bankEdge('left', y) + 20;
    const x1 = bankEdge('right', y) - 20;
    return { x: x0 + ((h >> 6) % Math.max(1, Math.round(x1 - x0))), y, ph: (h >> 3) % 628 / 100, w: 8 + (h % 3) * 6 };
  });

  // bóng cá to
  const shadow = buildShadow();
  lake.addChild(shadow.root);

  const king = new King();
  king.position.set(LAKE_SPOTS.kingHome.x, LAKE_SPOTS.kingHome.y);
  lake.addChild(king);

  const waterFx = new Container();
  lake.addChild(waterFx);

  const boat = buildBoat();
  boat.position.set(LAKE_SPOTS.boatDock.x, LAKE_SPOTS.boatDock.y);
  lake.addChild(boat);
  const boatRef = { root: boat, rock: 0 };

  // nước lũ tràn bờ
  const flood = new Graphics();
  flood.visible = false;
  lake.addChild(flood);

  // cần thủ
  const seatsLayer = new Container();
  const anglerFx = new Container();
  const anglers = new AnglerField(seatsLayer, anglerFx);
  lake.addChild(seatsLayer);

  const walkersLayer = new Container();
  const walkers = new Set<Walker>();
  lake.addChild(walkersLayer);

  // giông: phủ tối + mưa
  const darkness = new Graphics().rect(0, 0, 1080, 1920).fill(0x0a0f1e);
  darkness.alpha = 0;
  darkness.visible = false;
  const rain = new Graphics();
  rain.visible = false;
  const bolt = new Graphics();
  bolt.visible = false;
  lake.addChild(darkness, rain, bolt, anglerFx);

  const fx = new Container();
  lake.addChild(fx);

  bg.cacheAsTexture(true);

  // ----- Đáy hồ -----
  const underwater = buildUnderwater();
  root.addChild(underwater.root);

  // ----- Chớp sáng, chuyển cảnh, băng rôn -----
  const flashG = new Graphics().rect(0, 0, 1080, 1920).fill(0xffffff);
  flashG.alpha = 0;
  flashG.visible = false;
  const fade = new Graphics().rect(0, 0, 1080, 1920).fill(0x000000);
  fade.alpha = 0;
  fade.visible = false;
  const banner = new Container();
  const bannerG = new Graphics();
  const bannerText = label('', { fontSize: 44, fill: INK, align: 'center' });
  bannerText.anchor.set(0.5);
  banner.addChild(bannerG, bannerText);
  // giữa mặt hồ, dưới chiếu VIP (không che mặt người ngồi chiếu)
  banner.position.set(540, 1010);
  let bannerKey = '\u0000';
  /** Khung băng rôn ôm theo chữ (1 hoặc 2 dòng), tối đa gần hết bề ngang hồ. */
  const fitBanner = () => {
    if (bannerText.text === bannerKey) return;
    bannerKey = bannerText.text;
    bannerText.scale.set(1);
    if (bannerText.width > 760) bannerText.scale.set(760 / bannerText.width);
    const w = Math.max(420, Math.ceil(bannerText.width) + 64);
    const h = Math.ceil(bannerText.height) + 28;
    bannerG.clear();
    block(bannerG, -w / 2, -h / 2, w, h, 0xffd166, INK, 6);
  };
  banner.visible = false;
  root.addChild(flashG, fade, banner);

  // ----- Trạng thái động -----
  let t = 0;
  let frame = 0;
  let shake = 0;
  let gateOpen = 0;
  let floodK = -1;
  let storm = 0;
  let raining = false;
  let flashAt = -1e9;
  // bóng cá: vị trí, mục tiêu, độ hiện
  let shadowOn = false;
  let shadowA = 0;
  const sh = { x: 540, y: 1100, vx: 40, vy: 0, tx: 540, ty: 1100, retarget: 0 };

  const setFlood = (k: number) => {
    k = clamp01(k);
    if (Math.abs(k - floodK) < 0.005) return;
    floodK = k;
    flood.visible = k > 0;
    flood.clear();
    if (k <= 0) return;
    const c = { color: 0x3f7a9e, alpha: 0.6 };
    // bờ gần
    flood.rect(0, WATER.bottom - 6, 1080, k * 220).fill(c);
    flood.rect(0, WATER.bottom - 6 + k * 220, 1080, 4).fill({ color: 0xd8f0ff, alpha: 0.7 });
    // hai bờ bên
    for (let y = WATER.top; y < WATER.bottom; y += 16) {
      const w = k * 170;
      const xl = bankEdge('left', y);
      const xr = bankEdge('right', y);
      flood.rect(xl - w, y, w + 4, 16).fill(c).rect(xl - w, y, 4, 16).fill({ color: 0xd8f0ff, alpha: 0.6 });
      flood.rect(xr - 4, y, w + 4, 16).fill(c).rect(xr + w - 4, y, 4, 16).fill({ color: 0xd8f0ff, alpha: 0.6 });
    }
  };

  const weather: Weather = {
    setStorm(k) {
      storm = clamp01(k);
      darkness.visible = stormClouds.visible = storm > 0;
      darkness.alpha = storm * 0.55;
      stormClouds.alpha = storm;
    },
    setRain(on) {
      raining = on;
      rain.visible = on;
      if (!on) rain.clear();
    },
    flash() {
      flashAt = t;
      bolt.clear();
      let x = 160 + Math.random() * 760;
      let y = 440;
      while (y < 900) {
        const nx = x + (Math.random() - 0.5) * 70;
        const ny = y + 40 + Math.random() * 30;
        const steps = 6;
        for (let i = 0; i < steps; i++) bolt.rect(lerp(x, nx, i / steps) - 4, lerp(y, ny, i / steps), 8, (ny - y) / steps + 2).fill(0xfff6c8);
        x = nx;
        y = ny;
      }
      bolt.visible = true;
      flashG.visible = true;
    }
  };

  const tickWater = () => {
    waterAnim.clear();
    for (const s of sparkles) {
      const a = Math.sin(t * 0.0025 + s.ph);
      if (a < 0.35) continue;
      const dx = Math.sin(t * 0.0008 + s.ph) * 8;
      waterAnim.rect(s.x + dx, s.y, s.w, 3).fill({ color: 0xffffff, alpha: (a - 0.35) * 0.9 });
    }
  };

  const tickShadow = (dt: number) => {
    const target = shadowOn ? 1 : 0;
    shadowA += Math.sign(target - shadowA) * Math.min(Math.abs(target - shadowA), dt / 700);
    shadow.root.visible = shadowA > 0.001;
    if (!shadow.root.visible) return;
    shadow.root.alpha = shadowA;
    sh.retarget -= dt;
    const dist = Math.hypot(sh.tx - sh.x, sh.ty - sh.y);
    if (sh.retarget <= 0 || dist < 30) {
      // lượn quanh vùng nước giữa hồ, thỉnh thoảng sà tới gần phao của một cần thủ
      const occ = anglers.occupied();
      const pick = occ.length && Math.random() < 0.55 ? occ[Math.floor(Math.random() * occ.length)] : undefined;
      if (pick) {
        sh.tx = lerp(pick.rodTip.x, 540, 0.35);
        sh.ty = pick.rodTip.y + 60;
      } else {
        const a = Math.random() * Math.PI * 2;
        sh.tx = 540 + Math.cos(a) * 200;
        sh.ty = 1080 + Math.sin(a) * 220;
      }
      sh.retarget = 3500 + Math.random() * 2000;
    }
    const sp = 0.055;
    const ax = (sh.tx - sh.x) / Math.max(1, dist);
    const ay = (sh.ty - sh.y) / Math.max(1, dist);
    sh.vx = lerp(sh.vx, ax * sp * 1000, Math.min(1, dt / 900));
    sh.vy = lerp(sh.vy, ay * sp * 1000, Math.min(1, dt / 900));
    sh.x += (sh.vx * dt) / 1000;
    sh.y += (sh.vy * dt) / 1000;
    const minX = bankEdge('left', sh.y) + 150;
    const maxX = bankEdge('right', sh.y) - 150;
    sh.x = Math.max(minX, Math.min(maxX, sh.x));
    sh.y = Math.max(WATER.top + 90, Math.min(WATER.bottom - 60, sh.y));
    shadow.root.position.set(sh.x, sh.y);
    // cá bơi về phía trước = đầu bên trái hình
    if (Math.abs(sh.vx) > 4) shadow.g.scale.x = sh.vx > 0 ? -1 : 1;
    shadow.g.rotation = Math.sin(t * 0.004) * 0.05;
    shadow.g.y = Math.sin(t * 0.003) * 4;
    shadow.rings.forEach((r, i) => {
      const k = ((t / 1800 + i / 3) % 1 + 1) % 1;
      r.scale.set(0.6 + k * 1.2, 0.6 + k * 1.2);
      r.alpha = (1 - k) * 0.8;
      r.y = -10;
    });
  };

  return {
    root,
    fx,
    waterFx,
    king,
    anglers,
    spawnWalker() {
      const w = new Walker(1.3);
      w.visible = false;
      walkersLayer.addChild(w);
      walkers.add(w);
      return w;
    },
    removeWalker(w) {
      walkers.delete(w as Walker);
      w.destroy({ children: true });
    },
    setShake(k) {
      shake = clamp01(k);
      if (shake === 0) root.position.set(0, 0);
    },
    boat: boatRef,
    floodgate: {
      setOpen(k) {
        gateOpen = clamp01(k);
        gateDoor.y = -gateOpen * 58;
        gateDoor.visible = !photo || gateOpen > 0.01;
        stream.visible = gateOpen > 0.01;
      },
      setFlood
    },
    weather,
    bigFishShadow: {
      show(on) {
        if (on && !shadowOn && shadowA <= 0.001) {
          // bắt đầu từ phía xa của hồ
          sh.x = 540 + (Math.random() - 0.5) * 200;
          sh.y = WATER.top + 160;
          sh.retarget = 0;
        }
        shadowOn = on;
      }
    },
    underwater,
    fade,
    banner,
    bannerText,
    setMood(m: Mood) {
      king.setMood(m);
      underwater.king.setMood(m);
    },
    tick(dtMs) {
      t += dtMs;
      frame++;
      if (shake > 0) root.position.set((Math.random() - 0.5) * 2 * shake * 14, (Math.random() - 0.5) * 2 * shake * 10);
      if (underwater.root.visible) underwater.tick(dtMs);
      if (banner.visible) fitBanner();
      if (!lake.visible) return;
      if (frame % 2 === 0) tickWater();
      king.tick(dtMs);
      anglers.tick(dtMs);
      for (const w of walkers) if (w.visible) w.tick(dtMs);
      tickShadow(dtMs);
      // thuyền dập dềnh
      boat.rotation = Math.sin(t * 0.003) * 0.025 + boatRef.rock * Math.sin(t * 0.012) * 0.15;
      boat.pivot.y = Math.sin(t * 0.0025) * 2;
      // dòng nước xả cống
      if (stream.visible) {
        stream.clear();
        const top = gate.y - 6;
        stream.rect(gate.x - 30, top, 60, 70).fill({ color: 0x6fb0d0, alpha: 0.8 * gateOpen });
        for (let i = 0; i < 8; i++) {
          const y = top + ((t * 0.3 + i * 9) % 70);
          stream.rect(gate.x - 28 + ((i * 17) % 52), y, 6, 12).fill({ color: 0xffffff, alpha: 0.8 * gateOpen });
        }
        for (let i = 0; i < 6; i++) {
          const k = ((t / 600 + i / 6) % 1 + 1) % 1;
          stream.rect(gate.x - 40 - k * 50 + i * 16, top + 72 + k * 10, 10, 4).fill({ color: 0xe6f6ff, alpha: (1 - k) * gateOpen });
        }
      }
      // mưa
      if (raining) {
        rain.clear();
        for (let i = 0; i < 130; i++) {
          const x = ((i * 137.5 + t * 0.12) % 1180) - 50;
          const y = (i * 211 + t * 1.3) % 1920;
          rain.rect(x, y, 3, 18).fill({ color: 0xaecbe8, alpha: 0.55 }).rect(x - 3, y + 18, 3, 10).fill({ color: 0xaecbe8, alpha: 0.4 });
        }
      }
      // chớp
      if (flashG.visible) {
        const k = (t - flashAt) / 320;
        flashG.alpha = Math.max(0, 0.85 * (1 - k));
        bolt.alpha = Math.max(0, 1 - k * 0.8);
        if (k >= 1.25) {
          flashG.visible = false;
          bolt.visible = false;
        }
      }
    }
  };
}
