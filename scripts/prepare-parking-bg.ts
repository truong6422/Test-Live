/**
 * Cắt ảnh ngoại cảnh (bãi đỗ xe, ảnh ngang) thành phần giữa dùng làm nền cảnh "Xịt lốp" khung 9:16.
 *   bun scripts/prepare-parking-bg.ts [nguồn]
 * Mặc định đọc assets-src/parking.png, ghi apps/overlay/public/sprites/bg/parking.png.
 * Giữ nguyên độ phân giải gốc (overlay tự phóng to kiểu 'nearest'), chỉ cắt bớt hai bên để nhẹ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.join(import.meta.dir, '..');
const src = process.argv[2] ?? path.join(root, 'assets-src', 'parking.png');
const out = path.join(root, 'apps', 'overlay', 'public', 'sprites', 'bg', 'parking.png');

const img = PNG.sync.read(fs.readFileSync(src));
// Cửa toà nhà ở ~31% chiều ngang, các ô đỗ trống ở giữa: lấy dải 20%..73%.
const x0 = Math.round(img.width * 0.2);
const x1 = Math.round(img.width * 0.73);
const w = x1 - x0;
const crop = new PNG({ width: w, height: img.height });
for (let y = 0; y < img.height; y++) img.data.copy(crop.data, y * w * 4, (y * img.width + x0) * 4, (y * img.width + x1) * 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.sync.write(crop, { colorType: 2 }));
console.log(`parking.png ${w}×${img.height} (từ x=${x0}..${x1} của ${img.width}×${img.height})`);
