import { Graphics, type GraphicsContext } from 'pixi.js';

/** Bảng màu: ký tự trong lưới → màu. Ký tự không có trong bảng (vd '.') = trong suốt. */
export type Palette = Record<string, number>;

export const INK = 0x1b1b24;

/**
 * Vẽ ảnh pixel từ lưới ký tự. Các ô liền kề cùng màu trên một hàng được gộp thành một hình chữ nhật
 * để giảm số hình phải vẽ. Chỉ gọi khi dựng/đổi nhân vật — không gọi mỗi khung hình.
 */
export function drawGrid(g: Graphics, grid: readonly string[], pal: Palette, px: number, ox = 0, oy = 0): Graphics {
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

export function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
