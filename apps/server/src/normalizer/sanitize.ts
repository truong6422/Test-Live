// Làm sạch tên / bình luận từ nền tảng trước khi hiển thị lên overlay.

// Cuneiform, Braille, khối ký tự vẽ, ký tự điều khiển, ký tự định hướng (RTL override) — hay dùng để spam/phá giao diện.
const JUNK_RE = /[\u{12000}-\u{1254F}⠀-⣿▀-▟﷽‪-‮⁦-⁩​-‏\u0000-\u001F\u007F]/gu;
// Dấu kết hợp còn sót sau NFKC. Chữ tiếng Việt đều có dạng dựng sẵn nên dấu rời còn lại là Zalgo/rác.
const ZALGO_RE = /[̀-ͯ҉᪰-᫿᷀-᷿⃐-⃿]/g;
const BRACKET_EMOTE_RE = /\[[^\]]{1,24}\]/g;

function clean(raw: string | undefined | null): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(JUNK_RE, '')
    .replace(ZALGO_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Từ ngữ tục / xúc phạm bị che (dấu sao) trong tên và bình luận trước khi lên overlay.
 * So khớp theo TỪ, chữ thường, GIỮ dấu (bỏ dấu sẽ che nhầm từ thường như "các", "lớn").
 * Đây là danh sách MẶC ĐỊNH; danh sách đang dùng nằm trong cấu hình (`GameConfig.blocklist`, sửa ở tab
 * "Bộ lọc từ" trên dashboard) và được service nạp vào qua `setBlocklist`.
 */
export const DEFAULT_BLOCKLIST: readonly string[] = [
  'địt', 'đụ', 'lồn', 'cặc', 'buồi', 'đéo', 'đĩ', 'đcm', 'dcm', 'đmm', 'dmm', 'đm', 'dm', 'vcl', 'vkl', 'clm', 'cmm', 'cdm', 'fuck', 'shit'
];

/** Chuẩn hoá một từ để so khớp: NFC, chữ thường, bỏ dấu câu đầu/cuối. */
export function normalizeBlockedWord(w: string): string {
  return w.normalize('NFC').toLowerCase().trim().replace(EDGE_PUNCT_RE, '');
}

/** Chuẩn hoá cả danh sách: bỏ mục rỗng, bỏ trùng, giữ thứ tự. */
export function normalizeBlocklist(words: readonly string[]): string[] {
  return [...new Set(words.map(normalizeBlockedWord).filter(Boolean))];
}

// Dấu câu đầu/cuối một từ (để "đm!!" vẫn bị che).
const EDGE_PUNCT_RE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export const toBlockSet = (words: readonly string[]): ReadonlySet<string> => new Set(normalizeBlocklist(words));

/** Bộ lọc đang dùng cho normalizer (một server một danh sách). */
let BLOCKED: ReadonlySet<string> = toBlockSet(DEFAULT_BLOCKLIST);

/** Thay danh sách từ bị che đang dùng (service gọi khi nạp / lưu cấu hình). */
export function setBlocklist(words: readonly string[]): void {
  BLOCKED = toBlockSet(words);
}

/** Che các từ trong blocklist bằng dấu sao (giữ nguyên phần còn lại). */
export function maskBlocked(text: string, blocklist: ReadonlySet<string> = BLOCKED): string {
  return text
    .split(' ')
    .map((tok) => {
      const core = tok.normalize('NFC').toLowerCase().replace(EDGE_PUNCT_RE, '');
      return core && blocklist.has(core) ? '*'.repeat(Math.max(3, [...core].length)) : tok;
    })
    .join(' ');
}

export function cleanDisplayName(raw: string | undefined | null, fallback: string, blocklist?: ReadonlySet<string>): string {
  const cut = [...maskBlocked(clean(raw), blocklist)].slice(0, 24).join('');
  return cut.length >= 1 ? cut : fallback;
}

export function cleanComment(raw: string | undefined | null, blocklist?: ReadonlySet<string>): string {
  return [...maskBlocked(clean(String(raw ?? '').replace(BRACKET_EMOTE_RE, ' ')), blocklist)].slice(0, 200).join('');
}

/** Chỉ chấp nhận URL ảnh https (tránh javascript:/data: lên overlay). */
export function cleanAvatarUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
