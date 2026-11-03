import { useEffect, useState } from 'react';
import type { ActionConfig } from '@cau/shared';

/**
 * Ảnh cá cho dashboard, cắt từ sprite sheet của overlay (server phục vụ overlay ở /overlay/; Vite dev proxy /overlay).
 * Sheet 3×3 trên nền magenta, thứ tự theo hàng. Nền magenta được "key" ra trong suốt bằng canvas (một lần mỗi sheet),
 * mỗi ô thành một data URL. Không tải được sheet → hiện emoji.
 */
const BIG_SHEET = '/overlay/sprites/big-fish.png';
/** Có thể chưa có — khi thêm vào overlay thì dashboard tự dùng (thứ tự khớp bảng cá mặc định `fishing.loot`). */
const SMALL_SHEET = '/overlay/sprites/small-fish.png';

/** Thứ tự ô trong big-fish.png. */
const BIG_FISH_ORDER = [
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
/** Hành động dùng chung ảnh với loài khác. */
const BIG_ALIAS: Record<string, string> = { grand_haul: 'pull_legend' };
/** Tên cá to mặc định → id hành động (để tìm ảnh khi chỉ biết tên, vd. "con to nhất phiên"). */
const BIG_NAMES: Record<string, string> = {
  'cá chép to': 'pull_carp',
  'cá trắm cỏ': 'pull_grass_carp',
  'cá trê khổng lồ': 'pull_catfish',
  'cá lóc bông': 'pull_snakehead',
  'cá lăng khủng': 'pull_giant_catfish',
  'cá rồng vàng': 'pull_arowana',
  'cá đuối khổng lồ': 'pull_stingray',
  'cá koi đỏ trắng': 'pull_koi',
  'cá thần huyền thoại': 'pull_legend',
  'cá thần': 'pull_legend'
};
/** Thứ tự ô trong small-fish.png = thứ tự bảng cá mặc định (DEFAULT_LOOT ở server). */
const SMALL_FISH_ORDER = [
  'cá rô',
  'cá chép',
  'cá trắm',
  'tôm càng',
  'rùa (thả lại)',
  'chiếc ủng rách',
  'chiếc tất thối',
  'cá lăng khủng',
  'cá koi vàng'
];

const CELL_PX = 160;
/** Bỏ viền mỗi ô (đường kẻ lưới giữa các ô trên sheet), tính theo tỉ lệ cạnh ô. */
const INSET = 0.025;

type Cells = string[] | null;
const sheets = new Map<string, Promise<Cells>>();
const loaded = new Map<string, Cells>();

function loadSheet(url: string): Promise<Cells> {
  let p = sheets.get(url);
  if (!p) {
    p = new Promise<Cells>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          resolve(sliceSheet(img));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }).then((cells) => {
      loaded.set(url, cells);
      return cells;
    });
    sheets.set(url, p);
  }
  return p;
}

/** Cắt 9 ô, key nền magenta (kể cả viền pha) ra trong suốt. */
function sliceSheet(img: HTMLImageElement): Cells {
  if (!img.naturalWidth || !img.naturalHeight) return null;
  const cw = img.naturalWidth / 3;
  const ch = img.naturalHeight / 3;
  const canvas = document.createElement('canvas');
  canvas.width = CELL_PX;
  canvas.height = CELL_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const out: string[] = [];
  for (let i = 0; i < 9; i++) {
    const sx = (i % 3) * cw + cw * INSET;
    const sy = Math.floor(i / 3) * ch + ch * INSET;
    ctx.clearRect(0, 0, CELL_PX, CELL_PX);
    ctx.drawImage(img, sx, sy, cw * (1 - 2 * INSET), ch * (1 - 2 * INSET), 0, 0, CELL_PX, CELL_PX);
    const data = ctx.getImageData(0, 0, CELL_PX, CELL_PX);
    const d = data.data;
    for (let k = 0; k < d.length; k += 4) {
      const r = d[k]!;
      const g = d[k + 1]!;
      const b = d[k + 2]!;
      // "Độ magenta": đỏ và lam cao hơn hẳn lục.
      const m = Math.min(r, b) - g;
      if (m > 90) d[k + 3] = 0;
      else if (m > 40) {
        // Viền pha màu: mờ dần + khử ánh hồng.
        d[k + 3] = Math.round(d[k + 3]! * (1 - (m - 40) / 50));
        d[k] = Math.min(r, g + 40);
        d[k + 2] = Math.min(b, g + 40);
      }
    }
    ctx.putImageData(data, 0, 0);
    out.push(canvas.toDataURL('image/png'));
  }
  return out;
}

/** Ô ảnh của sheet (undefined = đang tải, null = không có sheet). */
function useSheet(url: string): Cells | undefined {
  const [cells, setCells] = useState<Cells | undefined>(() => (loaded.has(url) ? loaded.get(url) : undefined));
  useEffect(() => {
    let alive = true;
    void loadSheet(url).then((c) => alive && setCells(c));
    return () => {
      alive = false;
    };
  }, [url]);
  return cells;
}

const norm = (s: string | undefined) => (s ?? '').normalize('NFC').trim().toLowerCase();

/** Vị trí ô cá to theo id hành động; không có → theo tên cá (mặc định hoặc tên admin đặt trong `actions`). */
function bigIndex(actionId: string | undefined, name: string | undefined, actions?: readonly ActionConfig[]): number {
  let id = actionId ? (BIG_ALIAS[actionId] ?? actionId) : undefined;
  if (!id && name) {
    const n = norm(name);
    const byAction = actions?.find((a) => a.fish && norm(a.fish.name) === n)?.id;
    id = byAction ? (BIG_ALIAS[byAction] ?? byAction) : BIG_NAMES[n];
  }
  return id ? (BIG_FISH_ORDER as readonly string[]).indexOf(id) : -1;
}

export interface FishThumbProps {
  /** Id hành động kéo cá to (pull_*, grand_haul…). */
  actionId?: string;
  /** Tên cá (cá to hoặc cá thường) — dùng khi không có actionId. */
  name?: string;
  /** Hiện khi không có ảnh. */
  emoji: string;
  size?: number;
  /** Danh sách hành động (để nhận ra cá to admin đã đổi tên). */
  actions?: readonly ActionConfig[];
  /** Chỉ tìm trong sheet cá thường (bảng cá). */
  small?: boolean;
}

/** Ảnh cá nhỏ trong ô bo tròn; không có ảnh thì hiện emoji. */
export function FishThumb({ actionId, name, emoji, size = 36, actions, small }: FishThumbProps) {
  const big = useSheet(BIG_SHEET);
  const smallSheet = useSheet(SMALL_SHEET);
  let src: string | undefined;
  if (!small) {
    const i = bigIndex(actionId, name, actions);
    if (i >= 0) src = big?.[i];
  }
  if (!src && !actionId) {
    const j = SMALL_FISH_ORDER.indexOf(norm(name));
    if (j >= 0) src = smallSheet?.[j];
  }
  const style = { width: size, height: size, fontSize: Math.round(size * 0.62) };
  return (
    <span className="fish-thumb" style={style} title={name}>
      {src ? <img src={src} alt={name ?? ''} draggable={false} /> : <span aria-hidden>{emoji}</span>}
    </span>
  );
}
