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

export function cleanDisplayName(raw: string | undefined | null, fallback: string): string {
  const cut = [...clean(raw)].slice(0, 24).join('');
  return cut.length >= 1 ? cut : fallback;
}

export function cleanComment(raw: string | undefined | null): string {
  return [...clean(String(raw ?? '').replace(BRACKET_EMOTE_RE, ' '))].slice(0, 200).join('');
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
