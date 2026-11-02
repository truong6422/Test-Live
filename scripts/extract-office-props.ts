/**
 * Cắt đồ vật văn phòng từ assets-src/office-props.png (nền hồng #FF00FF phẳng) thành PNG trong suốt.
 *   bun scripts/extract-office-props.ts
 * Ghi ra apps/overlay/public/sprites/props/<id>.png (cắt sát vật). Toạ độ khung theo ảnh 1024×572.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.join(import.meta.dir, '..');
const SRC = path.join(root, 'assets-src', 'office-props.png');
const OUT = path.join(root, 'apps', 'overlay', 'public', 'sprites', 'props');

const PROPS = [
  { id: 'boss-desk', x0: 92, y0: 50, x1: 435, y1: 268 },
  { id: 'staff-desk', x0: 655, y0: 95, x1: 882, y1: 262 },
  { id: 'wc-door', x0: 95, y0: 322, x1: 250, y1: 545 },
  { id: 'wc-door-locked', x0: 272, y0: 322, x1: 440, y1: 545 },
  { id: 'breaker-up', x0: 645, y0: 362, x1: 740, y1: 495 },
  { id: 'breaker-down', x0: 780, y0: 352, x1: 906, y1: 505 }
];

/** Hồng nền (kể cả viền pha trộn): đỏ + xanh dương cao, xanh lá thấp hơn hẳn. */
const isBg = (r: number, g: number, b: number) => r > 150 && b > 150 && g < Math.min(r, b) - 70;

const img = PNG.sync.read(fs.readFileSync(SRC));
const k = img.width / 1024;
fs.mkdirSync(OUT, { recursive: true });
for (const p of PROPS) {
  const x0 = Math.round(p.x0 * k), y0 = Math.round(p.y0 * k);
  const w = Math.round(p.x1 * k) - x0, h = Math.round(p.y1 * k) - y0;
  const keep = new Uint8Array(w * h);
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4;
      if (isBg(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!)) continue;
      keep[y * w + x] = 1;
      (bx0 = Math.min(bx0, x)), (by0 = Math.min(by0, y)), (bx1 = Math.max(bx1, x)), (by1 = Math.max(by1, y));
    }
  const ow = bx1 - bx0 + 1, oh = by1 - by0 + 1;
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      if (!keep[(by0 + y) * w + bx0 + x]) continue;
      const i = ((y0 + by0 + y) * img.width + x0 + bx0 + x) * 4;
      const o = (y * ow + x) * 4;
      out.data[o] = img.data[i]!;
      out.data[o + 1] = img.data[i + 1]!;
      out.data[o + 2] = img.data[i + 2]!;
      out.data[o + 3] = 255;
    }
  fs.writeFileSync(path.join(OUT, `${p.id}.png`), PNG.sync.write(out));
  console.log(`${p.id}.png ${ow}×${oh}`);
}
