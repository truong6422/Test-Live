/**
 * Cắt sheet hoạt ảnh từng khung (frame-by-frame) của Sếp thành các dải PNG trong suốt.
 *
 *   bun scripts/extract-boss-frames.ts [đường-dẫn-sheet]
 *
 * Mặc định đọc assets-src/boss-frames.png (8 hàng × 8 khung, nền ca-rô sáng vẽ thẳng vào ảnh),
 * ghi apps/overlay/public/sprites/boss-anim/<tên>.png (8 khung xếp ngang, cùng kích thước)
 * và manifest.json. Mọi khung trong một hàng dùng CHUNG một khung cắt (hợp các bbox) để khi
 * phát lần lượt nhân vật không bị giật vị trí.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const SRC = process.argv[2] ?? 'assets-src/boss-frames.png';
const OUT = 'apps/overlay/public/sprites/boss-anim';

/** Dải dọc của từng hàng (đo từ khoảng trống giữa các hàng). */
const ROWS: [number, number][] = [
  [10, 146],
  [163, 300],
  [318, 445],
  [466, 609],
  [632, 770],
  [789, 929],
  [947, 1093],
  [1113, 1258]
];
/** Ranh giới cột (khoảng cách ~154px). */
const COL_EDGES = [14, 168, 322, 476, 630, 784, 938, 1092, 1226];
export const ANIMS = ['idle', 'walk', 'run', 'rage', 'scold', 'paper', 'desk', 'phone'] as const;

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, data } = png;

const isBg = (i: number, loose = false) => {
  const r = data[i]!,
    g = data[i + 1]!,
    b = data[i + 2]!;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = (r + g + b) / 3;
  return loose ? sat <= 22 && lum >= 185 : sat <= 16 && lum >= 212;
};

interface Cut {
  mask: Uint8Array; // 1 = giữ
  w: number;
  h: number;
  x0: number;
  y0: number;
  box: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** Tách nền một ô: loang nền từ mép, bỏ viền nhoè, giữ cụm lớn nhất + mảnh ở gần. */
function cutCell(x0: number, x1: number, y0: number, y1: number): Cut {
  const w = x1 - x0;
  const h = y1 - y0;
  const bg = new Uint8Array(w * h);
  const gi = (x: number, y: number) => ((y0 + y) * W + (x0 + x)) * 4;
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    const k = y * w + x;
    if (!bg[k] && isBg(gi(x, y))) {
      bg[k] = 1;
      stack.push(k);
    }
  };
  for (let x = 0; x < w; x++) (seed(x, 0), seed(x, h - 1));
  for (let y = 0; y < h; y++) (seed(0, y), seed(w - 1, y));
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % w,
      y = (k - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  for (let pass = 0; pass < 2; pass++) {
    const kill: number[] = [];
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        if (bg[k]) continue;
        if ((bg[k - 1] || bg[k + 1] || bg[k - w] || bg[k + w]) && isBg(gi(x, y), true)) kill.push(k);
      }
    kill.forEach((k) => (bg[k] = 1));
  }
  // các cụm
  const comp = new Int32Array(w * h).fill(-1);
  const comps: { n: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  for (let k0 = 0; k0 < w * h; k0++) {
    if (bg[k0] || comp[k0] !== -1) continue;
    const id = comps.length;
    const b = { n: 0, minX: w, minY: h, maxX: 0, maxY: 0 };
    const st = [k0];
    comp[k0] = id;
    while (st.length) {
      const k = st.pop()!;
      const x = k % w,
        y = (k - x) / w;
      b.n++;
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
      for (const nk of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1])
        if (nk >= 0 && !bg[nk] && comp[nk] === -1) {
          comp[nk] = id;
          st.push(nk);
        }
    }
    comps.push(b);
  }
  const mask = new Uint8Array(w * h);
  if (!comps.length) return { mask, w, h, x0, y0, box: null };
  const main = comps.reduce((a, b) => (b.n > a.n ? b : a));
  const pad = 40;
  const keep = comps.map((b) => b === main || (b.n >= 30 && b.maxX >= main.minX - pad && b.minX <= main.maxX + pad && b.maxY >= main.minY - pad && b.minY <= main.maxY + pad));
  let box: Cut['box'] = null;
  for (let k = 0; k < w * h; k++) {
    if (comp[k] < 0 || !keep[comp[k]!]) continue;
    mask[k] = 1;
    const x = k % w,
      y = (k - x) / w;
    box = box
      ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) }
      : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return { mask, w, h, x0, y0, box };
}

fs.mkdirSync(OUT, { recursive: true });
const manifest: Record<string, { frameW: number; frameH: number; frames: number }> = {};

ROWS.forEach(([y0, y1], r) => {
  const cuts = COL_EDGES.slice(0, -1).map((x0, c) => cutCell(x0, COL_EDGES[c + 1]!, y0, y1));
  // khung chung của cả hàng (toạ độ trong ô)
  const boxes = cuts.map((c) => c.box).filter((b): b is NonNullable<Cut['box']> => b !== null);
  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  const fw = maxX - minX + 1;
  const fh = maxY - minY + 1;
  const out = new PNG({ width: fw * cuts.length, height: fh });
  cuts.forEach((c, f) => {
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const cx = minX + x,
          cy = minY + y;
        const o = (y * out.width + f * fw + x) * 4;
        if (cx >= c.w || cy >= c.h || !c.mask[cy * c.w + cx]) continue;
        const i = ((c.y0 + cy) * W + (c.x0 + cx)) * 4;
        out.data[o] = data[i]!;
        out.data[o + 1] = data[i + 1]!;
        out.data[o + 2] = data[i + 2]!;
        out.data[o + 3] = 255;
      }
  });
  const name = ANIMS[r]!;
  fs.writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(out));
  manifest[name] = { frameW: fw, frameH: fh, frames: cuts.length };
  console.log(`${name.padEnd(6)} ${cuts.length} khung × ${fw}×${fh}`);
});
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
