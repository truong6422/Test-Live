/**
 * Cắt sheet nhân viên văn phòng (11 nhân vật × 11 tư thế) thành các dải PNG trong suốt.
 *
 *   bun scripts/extract-staff-sprites.ts [đường-dẫn-sheet]
 *
 * Mặc định đọc assets-src/staff-sheet.png (1536×1024, nền ca-rô sáng vẽ thẳng vào ảnh), ghi
 * apps/overlay/public/sprites/staff/c<hàng>.png (11 khung xếp ngang, cùng kích thước, khung
 * nào cũng canh đáy + canh giữa theo thân người để phát không bị giật) và manifest.json.
 *
 * Cách làm:
 *  1) loang nền từ mép ẢNH qua các điểm "ca-rô" (xám/trắng nhạt, gần như không màu) → trong suốt;
 *  2) bỏ 2 lớp viền nhoè sát nền;
 *  3) lưới: cột cố định (khe trống rõ), ranh giới hàng tìm riêng từng cột quanh vị trí danh
 *     nghĩa (các hàng dưới bị ép thấp nên có chỗ tóc hàng dưới chạm chân hàng trên);
 *  4) mỗi ô giữ cụm lớn nhất + mảnh ở gần (dấu giận đỏ, đồ cầm tay), bỏ mảnh chạm mép ô
 *     (thường là phần thừa của nhân vật hàng/cột bên cạnh).
 * KHÔNG xoá "lỗ" kín màu ca-rô: áo sơ mi trắng có bóng xám trùng màu ô ca-rô → bị đục lỗ.
 * Các khoảng hở giữa tay/thân trong sheet này đều thông ra ngoài nên loang từ mép là đủ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const SRC = process.argv[2] ?? 'assets-src/staff-sheet.png';
const OUT = 'apps/overlay/public/sprites/staff';

/** Ranh giới cột (giữa các khe trống; cột 10 là tư thế ngồi bàn, rộng hơn). */
const COL_EDGES = [0, 135, 260, 390, 515, 645, 765, 890, 1022, 1148, 1295, 1536];
/** Ranh giới hàng danh nghĩa (đáy ảnh = 1024); tinh chỉnh theo từng cột trong ±WIN px. */
const ROW_SPLITS = [0, 121, 241, 351, 453, 553, 663, 757, 832, 887, 953, 1024];
const WIN = 7;
/** Hàng 8 trong sheet chỉ có đầu (thân bị hàng 9 đè) → bỏ. */
const SKIP_ROWS = new Set([8]);
/** Khung vẽ nhầm sang người khác → thay bằng khung khác của chính nhân vật đó. */
const REMAP: Record<number, Record<number, number>> = {
  4: { 5: 4, 6: 4 }, // cột 5 là anh đeo kính, cột 6 là chị áo hồng
  6: { 8: 0, 9: 0 } // cột 8-9 là cô tóc tím
};

export const POSES = {
  idle: 0,
  walk: [1, 2, 3],
  angry: 4,
  shout: 5,
  scared: 6,
  cheer: 7,
  phone: 8,
  tablet: 9,
  seated: 10
};

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data } = png;

const lumAt = (k: number) => (data[k * 4]! + data[k * 4 + 1]! + data[k * 4 + 2]!) / 3;
const satAt = (k: number) => {
  const i = k * 4;
  return Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
};
const isBg = (k: number, loose = false) => {
  const s = satAt(k),
    l = lumAt(k);
  return loose ? s <= 22 && l >= 185 : s <= 16 && l >= 205;
};
// 1) nền toàn ảnh
const bg = new Uint8Array(W * H);
{
  const st: number[] = [];
  const seed = (k: number) => {
    if (!bg[k] && isBg(k)) {
      bg[k] = 1;
      st.push(k);
    }
  };
  for (let x = 0; x < W; x++) (seed(x), seed((H - 1) * W + x));
  for (let y = 0; y < H; y++) (seed(y * W), seed(y * W + W - 1));
  while (st.length) {
    const k = st.pop()!;
    const x = k % W;
    if (x > 0) seed(k - 1);
    if (x < W - 1) seed(k + 1);
    if (k >= W) seed(k - W);
    if (k < W * (H - 1)) seed(k + W);
  }
}
// 2) viền nhoè
for (let pass = 0; pass < 2; pass++) {
  const kill: number[] = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (bg[k]) continue;
      if ((bg[k - 1] || bg[k + 1] || bg[k - W] || bg[k + W]) && isBg(k, true)) kill.push(k);
    }
  kill.forEach((k) => (bg[k] = 1));
}

/** Ranh giới hàng cho một cột: hàng ngang ít điểm hình nhất quanh vị trí danh nghĩa. */
function splitsFor(c: number): number[] {
  const x0 = COL_EDGES[c]!,
    x1 = COL_EDGES[c + 1]!;
  return ROW_SPLITS.map((y, r) => {
    if (r === 0 || r === ROW_SPLITS.length - 1) return y;
    let best = y,
      bestN = Infinity;
    for (let yy = y - WIN; yy <= y + WIN; yy++) {
      let n = 0;
      for (let x = x0; x < x1; x++) if (!bg[yy * W + x]) n++;
      const score = n * 4 + Math.abs(yy - y); // ưu tiên ít điểm, hoà thì gần danh nghĩa
      if (score < bestN) ((bestN = score), (best = yy));
    }
    return best;
  });
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
interface Cut {
  /** toạ độ ảnh gốc của ô */
  x0: number;
  y0: number;
  w: number;
  h: number;
  mask: Uint8Array;
  box: Box;
  /** tâm ngang của thân (cụm lớn nhất), toạ độ trong ô */
  cx: number;
}

function cutCell(x0: number, x1: number, y0: number, y1: number): Cut {
  const w = x1 - x0,
    h = y1 - y0;
  const comp = new Int32Array(w * h).fill(-1);
  const comps: (Box & { n: number; edge: boolean })[] = [];
  const fg = (x: number, y: number) => !bg[(y0 + y) * W + x0 + x];
  for (let k0 = 0; k0 < w * h; k0++) {
    const x0k = k0 % w,
      y0k = (k0 - x0k) / w;
    if (comp[k0] !== -1 || !fg(x0k, y0k)) continue;
    const id = comps.length;
    const b = { n: 0, minX: w, minY: h, maxX: 0, maxY: 0, edge: false };
    const st = [k0];
    comp[k0] = id;
    while (st.length) {
      const k = st.pop()!;
      const x = k % w,
        y = (k - x) / w;
      b.n++;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) b.edge = true;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (comp[nk] === -1 && fg(nx, ny)) {
          comp[nk] = id;
          st.push(nk);
        }
      }
    }
    comps.push(b);
  }
  const main = comps.reduce((a, b) => (b.n > a.n ? b : a));
  const pad = 22;
  const keep = comps.map(
    (b) =>
      b === main ||
      (!b.edge &&
        b.n >= 12 &&
        b.maxX >= main.minX - pad &&
        b.minX <= main.maxX + pad &&
        b.maxY >= main.minY - pad &&
        b.minY <= main.maxY + pad)
  );
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (comp[k]! >= 0 && keep[comp[k]!]) mask[k] = 1;

  let box: Box | null = null;
  for (let k = 0; k < w * h; k++) {
    if (!mask[k]) continue;
    const x = k % w,
      y = (k - x) / w;
    box = box
      ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) }
      : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return { x0, y0, w, h, mask, box: box!, cx: Math.round((main.minX + main.maxX) / 2) };
}

fs.mkdirSync(OUT, { recursive: true });
/** boxes: vùng có hình của từng khung [x, y, w, h] (toạ độ trong khung) — để client co giãn đúng cỡ người. */
const characters: { id: string; frameW: number; frameH: number; frames: number; boxes: number[][] }[] = [];
const splitsByCol = COL_EDGES.slice(0, -1).map((_, c) => splitsFor(c));
const nRows = ROW_SPLITS.length - 1;
const nCols = COL_EDGES.length - 1;

for (let r = 0; r < nRows; r++) {
  if (SKIP_ROWS.has(r)) continue;
  const raw: Cut[] = [];
  for (let c = 0; c < nCols; c++) {
    const sp = splitsByCol[c]!;
    raw.push(cutCell(COL_EDGES[c]!, COL_EDGES[c + 1]!, sp[r]!, sp[r + 1]!));
  }
  const cuts = raw.map((_, f) => raw[REMAP[r]?.[f] ?? f]!);
  // khung chung: canh đáy, canh giữa theo thân
  const half = Math.max(...cuts.map((c) => Math.max(c.cx - c.box.minX, c.box.maxX - c.cx)));
  const fw = half * 2 + 1;
  const fh = Math.max(...cuts.map((c) => c.box.maxY - c.box.minY + 1));
  const out = new PNG({ width: fw * nCols, height: fh });
  const boxes: number[][] = [];
  cuts.forEach((c, f) => {
    const offX = f * fw + half - c.cx;
    const offY = fh - 1 - c.box.maxY;
    boxes.push([c.box.minX + offX - f * fw, c.box.minY + offY, c.box.maxX - c.box.minX + 1, c.box.maxY - c.box.minY + 1]);
    for (let y = c.box.minY; y <= c.box.maxY; y++)
      for (let x = c.box.minX; x <= c.box.maxX; x++) {
        if (!c.mask[y * c.w + x]) continue;
        const i = ((c.y0 + y) * W + c.x0 + x) * 4;
        const o = ((y + offY) * out.width + x + offX) * 4;
        out.data[o] = data[i]!;
        out.data[o + 1] = data[i + 1]!;
        out.data[o + 2] = data[i + 2]!;
        out.data[o + 3] = 255;
      }
  });
  const id = `c${r}`;
  fs.writeFileSync(path.join(OUT, `${id}.png`), PNG.sync.write(out, { colorType: 6 }));
  characters.push({ id, frameW: fw, frameH: fh, frames: nCols, boxes });
  console.log(`${id.padEnd(4)} ${nCols} khung × ${fw}×${fh}`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ characters, poses: POSES }, null, 2) + '\n');
