/**
 * Cắt đồ vật từ assets-src/props-sheet.png (bản sao "do vat.png", nền ô cờ xám in sẵn) thành PNG trong suốt.
 *   bun scripts/extract-props.ts
 * Ghi ra apps/overlay/public/sprites/props/<id>.png. Muốn thêm đồ vật: thêm một dòng vào PROPS
 * (toạ độ trên ảnh gốc 2816×1536, khung rộng một chút quanh vật, không dính chữ tiêu đề).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.join(import.meta.dir, '..');
const SRC = path.join(root, 'assets-src', 'props-sheet.png');
const OUT = path.join(root, 'apps', 'overlay', 'public', 'sprites', 'props');

const PROPS: { id: string; x0: number; y0: number; x1: number; y1: number }[] = [
  { id: 'car', x0: 1100, y0: 190, x1: 1680, y1: 455 },
  { id: 'ambulance', x0: 2270, y0: 165, x1: 2730, y1: 455 },
  { id: 'scooter', x0: 70, y0: 175, x1: 485, y1: 450 },
  { id: 'plant', x0: 95, y0: 700, x1: 300, y1: 1045 }
];

/** Ô cờ nền: xám trung tính, khá sáng. */
const isBg = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b) <= 10 && (r + g + b) / 3 >= 118;

const img = PNG.sync.read(fs.readFileSync(SRC));
fs.mkdirSync(OUT, { recursive: true });

for (const p of PROPS) {
  const w = p.x1 - p.x0;
  const h = p.y1 - p.y0;
  const at = (x: number, y: number) => ((p.y0 + y) * img.width + p.x0 + x) * 4;
  // flood fill nền từ viền khung
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || bg[y * w + x]) return;
    const i = at(x, y);
    if (!isBg(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!)) return;
    bg[y * w + x] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < w; x++) push(x, 0), push(x, h - 1);
  for (let y = 0; y < h; y++) push(0, y), push(w - 1, y);
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    push(x + 1, y), push(x - 1, y), push(x, y + 1), push(x, y - 1);
  }
  // xoá viền sáng lẫn nền (1 px quanh vật)
  const halo = new Uint8Array(bg);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (bg[y * w + x]) continue;
      const near = bg[y * w + x + 1] || bg[y * w + x - 1] || bg[(y + 1) * w + x] || bg[(y - 1) * w + x];
      const i = at(x, y);
      const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!;
      if (near && Math.max(r, g, b) - Math.min(r, g, b) <= 18 && (r + g + b) / 3 >= 105) halo[y * w + x] = 1;
    }
  // khung bao vật
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!halo[y * w + x]) {
        bx0 = Math.min(bx0, x), by0 = Math.min(by0, y), bx1 = Math.max(bx1, x), by1 = Math.max(by1, y);
      }
  const ow = bx1 - bx0 + 1;
  const oh = by1 - by0 + 1;
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const sx = bx0 + x, sy = by0 + y;
      const o = (y * ow + x) * 4;
      if (halo[sy * w + sx]) continue; // trong suốt
      const i = at(sx, sy);
      out.data[o] = img.data[i]!;
      out.data[o + 1] = img.data[i + 1]!;
      out.data[o + 2] = img.data[i + 2]!;
      out.data[o + 3] = 255;
    }
  fs.writeFileSync(path.join(OUT, `${p.id}.png`), PNG.sync.write(out));
  console.log(`${p.id}.png ${ow}×${oh}`);
}
