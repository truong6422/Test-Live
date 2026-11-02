/**
 * Cắt chuỗi "vặt lá" cây bonsai (assets-src/tree-sheet.png, bản sao "cay.png", nền ô cờ in sẵn)
 * thành một dải PNG trong suốt: apps/overlay/public/sprites/props/tree.png + tree.json.
 *   bun scripts/extract-tree.ts
 * Dùng 5 ô hàng trên: nguyên vẹn → trụi lá. Các khung cùng kích thước, căn đáy chậu, để không bị giật.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.join(import.meta.dir, '..');
const SRC = path.join(root, 'assets-src', 'tree-sheet.png');
const OUT = path.join(root, 'apps', 'overlay', 'public', 'sprites', 'props');

// Khung ô (toạ độ ảnh gốc 2816×1536), đã lùi vào trong viền đen của ô.
const CELLS_X: [number, number][] = [
  [100, 556],
  [641, 1100],
  [1181, 1637],
  [1720, 2177],
  [2260, 2716]
];
const CELL_Y: [number, number] = [235, 752];
// Con trỏ chuột vẽ lẫn trong ô thứ 2 → xoá.
const ERASE = [{ x0: 995, y0: 300, x1: 1070, y1: 380 }];

const isBg = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b) <= 12 && (r + g + b) / 3 >= 66;

const img = PNG.sync.read(fs.readFileSync(SRC));
const W = img.width;
for (const e of ERASE)
  for (let y = e.y0; y < e.y1; y++)
    for (let x = e.x0; x < e.x1; x++) {
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 180;
    }

type Frame = { mask: Uint8Array; x0: number; w: number; h: number; bbox: [number, number, number, number] };
const frames: Frame[] = CELLS_X.map(([x0, x1]) => cut(x0, x1, CELL_Y[0], CELL_Y[1]));

/** Mặt nạ nền (1 = nền) của vùng [x0,x1)×[y0,y1) + khung bao vật. */
function cut(x0: number, x1: number, y0: number, y1: number): Frame {
  const w = x1 - x0;
  const h = y1 - y0;
  const at = (x: number, y: number) => ((y0 + y) * W + x0 + x) * 4;
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
  // Ô cờ bị kẹt giữa tán lá (không nối ra viền): xoá mọi vùng màu-nền liền nhau ≥ 60 px.
  const seen = new Uint8Array(w * h);
  for (let sy = 0; sy < h; sy++)
    for (let sx = 0; sx < w; sx++) {
      const k0 = sy * w + sx;
      if (bg[k0] || seen[k0]) continue;
      const i0 = at(sx, sy);
      if (!isBg(img.data[i0]!, img.data[i0 + 1]!, img.data[i0 + 2]!)) continue;
      const comp: number[] = [k0];
      seen[k0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const cx = comp[q]! % w;
        const cy = (comp[q]! - cx) / w;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (seen[nk] || bg[nk]) continue;
          const ni = at(nx, ny);
          if (!isBg(img.data[ni]!, img.data[ni + 1]!, img.data[ni + 2]!)) continue;
          seen[nk] = 1;
          comp.push(nk);
        }
      }
      if (comp.length >= 60) for (const k of comp) bg[k] = 1;
    }
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!bg[y * w + x]) (bx0 = Math.min(bx0, x)), (by0 = Math.min(by0, y)), (bx1 = Math.max(bx1, x)), (by1 = Math.max(by1, y));
  return { mask: bg, x0, w, h, bbox: [bx0, by0, bx1, by1] };
}

// Khung chung: căn theo đáy chậu (by1) và tâm ngang của chậu ~ giữa bbox.
const fw = Math.max(...frames.map((f) => f.bbox[2] - f.bbox[0] + 1)) + 8;
const fh = Math.max(...frames.map((f) => f.bbox[3] - f.bbox[1] + 1)) + 4;
const out = new PNG({ width: fw * frames.length, height: fh });
frames.forEach((f, n) => {
  const [bx0, , bx1, by1] = f.bbox;
  const cx = Math.round((bx0 + bx1) / 2);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const sx = cx - Math.floor(fw / 2) + x;
      const sy = by1 - (fh - 1) + y;
      if (sx < 0 || sy < 0 || sx >= f.w || sy >= f.h || f.mask[sy * f.w + sx]) continue;
      const i = ((CELL_Y[0] + sy) * W + f.x0 + sx) * 4;
      const o = (y * out.width + n * fw + x) * 4;
      out.data[o] = img.data[i]!;
      out.data[o + 1] = img.data[i + 1]!;
      out.data[o + 2] = img.data[i + 2]!;
      out.data[o + 3] = 255;
    }
});
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'tree.png'), PNG.sync.write(out));
fs.writeFileSync(path.join(OUT, 'tree.json'), JSON.stringify({ frameW: fw, frameH: fh, frames: frames.length }));
console.log(`tree.png ${frames.length} khung ${fw}×${fh}`);

// ---------------------------------------------------------------------------
// Lá rời (cắt từ cùng ảnh): cụm lá nhỏ dưới gốc (ô 2, ô 3) và đống lá lớn (ô cuối hàng dưới).
// Dùng cho hiệu ứng lá bay ra khi vặt + đống lá rụng. Toạ độ ảnh gốc, khung rộng quanh vật.
const LEAVES = [
  { id: 'leaf-clump', x0: 940, y0: 680, x1: 1090, y1: 752 },
  { id: 'leaf-clump2', x0: 1480, y0: 680, x1: 1640, y1: 752 },
  { id: 'leaf-pile', x0: 2260, y0: 1300, x1: 2700, y1: 1415 }
];
for (const c of LEAVES) {
  const { mask, w, h } = cut(c.x0, c.x1, c.y0, c.y1);
  // chỉ giữ khối liền lớn nhất (bỏ vụn ô cờ / mảnh ô bên cạnh)
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0;
  for (let k0 = 0, id = 0; k0 < w * h; k0++) {
    if (mask[k0] || label[k0] >= 0) continue;
    const q = [k0];
    label[k0] = id;
    for (let n = 0; n < q.length; n++) {
      const cx = q[n]! % w, cy = (q[n]! - cx) / w;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (mask[nk] || label[nk] >= 0) continue;
        label[nk] = id;
        q.push(nk);
      }
    }
    if (q.length > bestSize) (bestSize = q.length), (best = id);
    id++;
  }
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let k = 0; k < w * h; k++) {
    if (label[k] !== best) {
      mask[k] = 1;
      continue;
    }
    const x = k % w, y = (k - x) / w;
    (bx0 = Math.min(bx0, x)), (by0 = Math.min(by0, y)), (bx1 = Math.max(bx1, x)), (by1 = Math.max(by1, y));
  }
  const ow = bx1 - bx0 + 1;
  const oh = by1 - by0 + 1;
  const png = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const sx = bx0 + x, sy = by0 + y;
      if (mask[sy * w + sx]) continue;
      const i = ((c.y0 + sy) * W + c.x0 + sx) * 4;
      const o = (y * ow + x) * 4;
      png.data[o] = img.data[i]!;
      png.data[o + 1] = img.data[i + 1]!;
      png.data[o + 2] = img.data[i + 2]!;
      png.data[o + 3] = 255;
    }
  fs.writeFileSync(path.join(OUT, `${c.id}.png`), PNG.sync.write(png));
  console.log(`${c.id}.png ${ow}×${oh}`);
}
