/**
 * Chuẩn bị ảnh tường văn phòng: assets-src/office-wall.png (ngang 16:9, tường + bục Sếp)
 * → apps/overlay/public/sprites/bg/office-wall.png.
 *   bun scripts/prepare-office-wall.ts
 * Xoá dấu ngôi sao của công cụ tạo ảnh ở góc phải dưới (vá bằng vân sàn bên trái nó).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.join(import.meta.dir, '..');
const SRC = path.join(root, 'assets-src', 'office-wall.png');
const OUT = path.join(root, 'apps', 'overlay', 'public', 'sprites', 'bg', 'office-wall.png');

const img = PNG.sync.read(fs.readFileSync(SRC));
// toạ độ theo tỉ lệ ảnh (bản gốc 1024×572)
const k = img.width / 1024;
const patch = { x0: 905, y0: 458, x1: 968, y1: 512, dx: -96 };
for (let y = Math.round(patch.y0 * k); y < Math.round(patch.y1 * k); y++)
  for (let x = Math.round(patch.x0 * k); x < Math.round(patch.x1 * k); x++) {
    const o = (y * img.width + x) * 4;
    const i = (y * img.width + x + Math.round(patch.dx * k)) * 4;
    for (let c = 0; c < 4; c++) img.data[o + c] = img.data[i + c]!;
  }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PNG.sync.write(img));
console.log(`office-wall.png ${img.width}×${img.height}`);
