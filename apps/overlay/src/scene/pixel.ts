import { Graphics, type GraphicsContext } from 'pixi.js';

/** Bảng màu: ký tự trong lưới → màu. Ký tự không có trong bảng (vd '.') = trong suốt. */
export type Palette = Record<string, number>;

export const INK = 0x1b1b24;

/**
 * Vẽ ảnh pixel từ lưới ký tự. Các ô liền kề cùng màu trên một hàng được gộp thành một hình chữ nhật
 * để giảm số hình phải vẽ. Chỉ gọi khi dựng/đổi nhân vật — không gọi mỗi khung hình.
 */
export function drawGrid<G extends Graphics | GraphicsContext>(g: G, grid: readonly string[], pal: Palette, px: number, ox = 0, oy = 0): G {
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      const color = pal[ch];
      if (color !== undefined) g.rect(ox + x * px, oy + y * px, (end - x) * px, px).fill(color);
      x = end;
    }
  });
  return g;
}

/** Khối chữ nhật có viền đậm kiểu pixel art. */
export function block<G extends Graphics | GraphicsContext>(g: G, x: number, y: number, w: number, h: number, fill: number, outline: number | null = INK, t = 4): G {
  if (outline !== null) g.rect(x - t, y - t, w + 2 * t, h + 2 * t).fill(outline);
  g.rect(x, y, w, h).fill(fill);
  return g;
}

/**
 * Khung pixel góc khuyết bậc thang (thay roundRect vector): viền mực dày t, góc khuyết c — cùng kiểu nét mực
 * của ảnh nền pixel. (x, y, w, h) là phần ruột; viền nằm ngoài.
 */
export function pixelPanel<G extends Graphics | GraphicsContext>(g: G, x: number, y: number, w: number, h: number, fill: number, ink: number = INK, t = 3, c = 3): G {
  g.rect(x - t + c, y - t, w + 2 * t - 2 * c, h + 2 * t).fill(ink);
  g.rect(x - t, y - t + c, w + 2 * t, h + 2 * t - 2 * c).fill(ink);
  g.rect(x + c, y, w - 2 * c, h).fill(fill);
  g.rect(x, y + c, w, h - 2 * c).fill(fill);
  return g;
}

export function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
