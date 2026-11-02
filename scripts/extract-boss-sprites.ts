/**
 * Cắt sprite Sếp từ tấm sheet (nền ca-rô xám được vẽ thẳng vào ảnh, không phải trong suốt thật).
 *
 *   bun scripts/extract-boss-sprites.ts [đường-dẫn-sheet]
 *
 * Mặc định đọc assets-src/boss-sheet.png, ghi apps/overlay/public/sprites/boss/<id>.png.
 * Cách làm: với mỗi ô, loang (flood fill) từ mép ô qua các điểm "xám ca-rô" → trong suốt,
 * bỏ thêm 1-2 lớp viền xám còn sót, giữ cụm điểm lớn nhất (+ các mảnh nằm sát nó), rồi cắt sát.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const SRC = process.argv[2] ?? 'assets-src/boss-sheet.png';
const OUT = 'apps/overlay/public/sprites/boss';

// Toạ độ theo ảnh gốc 2816×1536. Dải hàng tránh phần chữ chú thích.
const ROWS: [number, number][] = [
  [75, 340],
  [446, 712],
  [812, 1076],
  [1196, 1470]
];
const COLS: [number, number][] = [
  [0, 668],
  [668, 1179],
  [1179, 1696],
  [1696, 2224],
  [2224, 2816]
];
const IDS = [
  ['shocked', 'furious', 'shouting', 'blaming', 'weary'],
  ['walking', 'thinking', 'cold', 'pleased', 'despair'],
  ['inspect', 'signing', 'phone', 'sos', 'throw_docs'],
  ['scold_staff', 'praise_staff', 'computer', 'coffee', 'motorbike']
];

/** Cắt bớt theo từng ô (vd: ô xe máy có dấu watermark ở góc phải). */
const LIMIT_X: Record<string, number> = { motorbike: 2668 };

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, data } = png;

const isChecker = (i: number, loose = false) => {
  const r = data[i]!,
    g = data[i + 1]!,
    b = data[i + 2]!;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = (r + g + b) / 3;
  return loose ? sat <= 20 && lum >= 95 && lum <= 225 : sat <= 14 && lum >= 112 && lum <= 214;
};

fs.mkdirSync(OUT, { recursive: true });

for (let r = 0; r < ROWS.length; r++)
  for (let c = 0; c < COLS.length; c++) {
    const [y0, y1] = ROWS[r]!;
    const id = IDS[r]![c]!;
    const x0 = COLS[c]![0];
    const x1 = Math.min(COLS[c]![1], LIMIT_X[id] ?? Infinity);
    const w = x1 - x0;
    const h = y1 - y0;
    // 0 = chưa xét, 1 = nền, 2 = hình
    const mask = new Uint8Array(w * h);
    const gi = (x: number, y: number) => ((y0 + y) * W + (x0 + x)) * 4;

    // 1) loang nền từ mép ô
    const stack: number[] = [];
    const seed = (x: number, y: number) => {
      const k = y * w + x;
      if (mask[k] === 0 && isChecker(gi(x, y))) {
        mask[k] = 1;
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

    // 2) bỏ viền xám nhoè sát nền (2 lượt)
    for (let pass = 0; pass < 2; pass++) {
      const kill: number[] = [];
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const k = y * w + x;
          if (mask[k] === 1) continue;
          const nearBg = mask[k - 1] === 1 || mask[k + 1] === 1 || mask[k - w] === 1 || mask[k + w] === 1;
          if (nearBg && isChecker(gi(x, y), true)) kill.push(k);
        }
      kill.forEach((k) => (mask[k] = 1));
    }

    // 3) tìm các cụm điểm hình
    const comp = new Int32Array(w * h).fill(-1);
    const comps: { n: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];
    for (let k0 = 0; k0 < w * h; k0++) {
      if (mask[k0] === 1 || comp[k0] !== -1) continue;
      const id = comps.length;
      const box = { n: 0, minX: w, minY: h, maxX: 0, maxY: 0 };
      const st = [k0];
      comp[k0] = id;
      while (st.length) {
        const k = st.pop()!;
        const x = k % w,
          y = (k - x) / w;
        box.n++;
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y);
        box.maxY = Math.max(box.maxY, y);
        for (const nk of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
          if (nk >= 0 && mask[nk] !== 1 && comp[nk] === -1) {
            comp[nk] = id;
            st.push(nk);
          }
        }
      }
      comps.push(box);
    }
    const main = comps.reduce((a, b) => (b.n > a.n ? b : a));
    const pad = 70;
    const keep = new Set<number>();
    comps.forEach((b, id) => {
      const near = b.maxX >= main.minX - pad && b.minX <= main.maxX + pad && b.maxY >= main.minY - pad && b.minY <= main.maxY + pad;
      if (b === main || (near && b.n >= 120)) keep.add(id);
    });
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    keep.forEach((id) => {
      const b = comps[id]!;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    });

    // 4) ghi PNG trong suốt, cắt sát
    const ow = maxX - minX + 1;
    const oh = maxY - minY + 1;
    const out = new PNG({ width: ow, height: oh });
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        const k = (minY + y) * w + (minX + x);
        const o = (y * ow + x) * 4;
        if (!keep.has(comp[k]!)) {
          out.data[o + 3] = 0;
          continue;
        }
        const i = gi(minX + x, minY + y);
        out.data[o] = data[i]!;
        out.data[o + 1] = data[i + 1]!;
        out.data[o + 2] = data[i + 2]!;
        out.data[o + 3] = 255;
      }
    fs.writeFileSync(path.join(OUT, `${id}.png`), PNG.sync.write(out));
    console.log(`${id.padEnd(14)} ${ow}×${oh}`);
  }
