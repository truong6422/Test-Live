import { Texture } from 'pixi.js';

/*
 * Ảnh tuỳ chọn (không có thì mọi thứ vẽ pixel bằng code):
 *   public/bg/lake.png            1080×1920 — trời + bờ xa, hồ giữa, bờ cỏ trái/phải, bờ gần
 *   public/sprites/big-fish.png   lưới 3×3 trên nền magenta #FF00FF (khử nền khi tải), mọi con cá quay đầu sang PHẢI
 *   public/sprites/small-fish.png lưới 3×3 trên nền magenta, KHÔNG có vạch kẻ ô, mọi món quay đầu sang TRÁI
 *                                 (thứ tự = fishing.loot mặc định: rô, chép, trắm / tôm, rùa, ủng / tất, lăng, koi vàng)
 *   public/sprites/anglers.png    lưới 3×3 trên nền magenta, không vạch kẻ ô: hàng 1–2 = 6 người ngồi ghế nhìn sang PHẢI,
 *                                 hàng 3 = 3 người ngồi nhìn thẳng (chiếu VIP). Cần câu do code vẽ.
 * Gọi loadAssets() một lần trước buildLake().
 */

/** Thứ tự ô trong big-fish.png (hàng trái → phải, trên → dưới). */
const FISH_ORDER = [
  'pull_carp',
  'pull_grass_carp',
  'pull_catfish',
  'pull_snakehead',
  'pull_giant_catfish',
  'pull_arowana',
  'pull_stingray',
  'pull_koi',
  'pull_legend'
] as const;
/** Hành động không có ô riêng → dùng ảnh của loài khác. */
const FISH_ALIAS: Record<string, (typeof FISH_ORDER)[number]> = { grand_haul: 'pull_legend' };

/** Thứ tự ô trong small-fish.png (khoá = tên loot đã bỏ dấu, chữ thường, bỏ phần trong ngoặc). */
const SMALL_ORDER = ['ca ro', 'ca chep', 'ca tram', 'tom cang', 'rua', 'chiec ung rach', 'chiec tat thoi', 'ca lang khung', 'ca koi vang'] as const;
/** Không khớp tên → đoán theo emoji của loot. */
const SMALL_BY_EMOJI: Record<string, (typeof SMALL_ORDER)[number]> = {
  '🐟': 'ca ro',
  '🐠': 'ca chep',
  '🐡': 'ca tram',
  '🦐': 'tom cang',
  '🐢': 'rua',
  '🥾': 'chiec ung rach',
  '🧦': 'chiec tat thoi',
  '🦈': 'ca lang khung',
  '👑': 'ca koi vang'
};
const smallTex = new Map<string, Texture>();

/** "Rùa (thả lại)" → "rua"; "Cá Koi Vàng" → "ca koi vang". */
const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Ảnh cá thường theo tên loot (không phân biệt hoa/thường, dấu), dự phòng theo emoji. Ảnh quay đầu sang TRÁI. */
export function smallFishTexture(name: string, emoji?: string): Texture | null {
  if (!smallTex.size) return null;
  const n = normName(name);
  const exact = smallTex.get(n);
  if (exact) return exact;
  const key = SMALL_ORDER.find((k) => n.startsWith(k) || n.includes(k));
  if (key && n) return smallTex.get(key) ?? null;
  const byEmoji = emoji ? SMALL_BY_EMOJI[emoji] : undefined;
  return byEmoji ? (smallTex.get(byEmoji) ?? null) : null;
}

let lakeBg: Texture | null = null;
let anglerSheet: Texture | null = null;
/** Ô 0–5: ngồi nghiêng nhìn sang PHẢI; ô 6–8: ngồi nhìn thẳng (chiếu VIP). */
const ANGLER_IDS = ['s0', 's1', 's2', 's3', 's4', 's5', 'f0', 'f1', 'f2'] as const;
const anglerTex = new Map<string, Texture>();

/** Ảnh cần thủ theo kiểu nhìn, chọn theo seed (null → vẽ pixel bằng code). Gốc ảnh = giữa mép dưới (ghế đẩu). */
export function anglerTexture(view: 'side' | 'face', seed: number): Texture | null {
  const ids = ANGLER_IDS.filter((id) => id[0] === view[0] && anglerTex.has(id));
  if (!ids.length) return null;
  return anglerTex.get(ids[(seed >>> 0) % ids.length]!)!;
}
const fishTex = new Map<string, Texture>();

/** Ảnh nền hồ (null nếu không có ảnh). */
export const lakeBackground = (): Texture | null => lakeBg;

/** Ô đầu tiên của bảng sprite cần thủ (null nếu không có ảnh) — giữ cho tương thích. */
export const anglerSheetTexture = (): Texture | null => anglerSheet;

/** Ảnh cá to theo id hành động (null → hoạt ảnh tự vẽ cá pixel). */
export function bigFishTexture(actionId: string): Texture | null {
  return fishTex.get(actionId) ?? fishTex.get(FISH_ALIAS[actionId] ?? '') ?? null;
}

/** Tải ảnh nếu có — chỉ nhận phản hồi thật sự là ảnh (dev server trả index.html cho đường dẫn thiếu). */
async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

function toTexture(canvas: HTMLCanvasElement): Texture {
  const t = Texture.from(canvas);
  t.source.scaleMode = 'nearest';
  return t;
}

async function loadLakeBg(base: string): Promise<void> {
  const img = await loadImage(`${base}bg/lake.png`);
  if (!img) return;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  lakeBg = toTexture(c);
}

async function loadAnglerSheet(base: string): Promise<void> {
  const img = await loadImage(`${base}sprites/anglers.png`);
  if (!img) return;
  sliceGrid(img, ANGLER_IDS, 2, anglerTex);
  anglerSheet = anglerTex.get('s0') ?? null;
}

/**
 * Cắt ảnh lưới 3×3 trên nền magenta: mỗi ô lùi vào inset px (bỏ vạch kẻ ô nếu có), khử nền magenta theo ngưỡng
 * (chịu được các mảng magenta lệch tông), bớt viền hồng, rồi cắt sát phần có hình.
 */
function sliceGrid(img: ImageBitmap, ids: readonly string[], inset: number, into: Map<string, Texture>): void {
  const cw = img.width / 3;
  const ch = img.height / 3;
  ids.forEach((id, i) => {
    const sx = Math.round((i % 3) * cw) + inset;
    const sy = Math.round(Math.floor(i / 3) * ch) + inset;
    const w = Math.floor(cw) - inset * 2;
    const h = Math.floor(ch) - inset * 2;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let k = 0, n = 0; k < p.length; k += 4, n++) {
      const r = p[k]!;
      const g = p[k + 1]!;
      const b = p[k + 2]!;
      if (r > 150 && b > 150 && g < 110) {
        p[k + 3] = 0;
        continue;
      }
      // viền gần magenta: mờ dần + bớt sắc hồng để không bị viền hồng
      const pink = Math.min(r, b) - g;
      if (pink > 40 && r > 100 && b > 100) {
        const keep = Math.max(0, Math.min(1, 1 - (pink - 40) / 80));
        p[k + 3] = Math.round(p[k + 3]! * keep);
        p[k] = Math.round(lerpN(r, g, 0.5));
        p[k + 2] = Math.round(lerpN(b, g, 0.5));
      }
      if (p[k + 3]! > 16) {
        const x = n % w;
        const y = (n / w) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return;
    ctx.putImageData(data, 0, 0);
    const tw = x1 - x0 + 1;
    const th = y1 - y0 + 1;
    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    out.getContext('2d')!.drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
    into.set(id, toTexture(out));
  });
}

async function loadBigFish(base: string): Promise<void> {
  const img = await loadImage(`${base}sprites/big-fish.png`);
  if (img) sliceGrid(img, FISH_ORDER, 6, fishTex);
}

async function loadSmallFish(base: string): Promise<void> {
  const img = await loadImage(`${base}sprites/small-fish.png`);
  // không có vạch kẻ ô: lùi vào 2px cho chắc khỏi dính mép ô bên cạnh
  if (img) sliceGrid(img, SMALL_ORDER, 2, smallTex);
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

/** Tải mọi ảnh tuỳ chọn; lỗi/thiếu ảnh nào thì bỏ qua. Không bao giờ ném lỗi. */
export async function loadAssets(timeoutMs = 4000): Promise<void> {
  const base = import.meta.env.BASE_URL;
  await Promise.race([Promise.all([loadLakeBg(base), loadBigFish(base), loadSmallFish(base), loadAnglerSheet(base)]), new Promise((r) => setTimeout(r, timeoutMs))]);
}
