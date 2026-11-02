/**
 * Chuẩn hoá chuỗi để so khớp từ khoá: bỏ dấu tiếng Việt, chữ thường,
 * thay mọi ký tự không phải chữ/số bằng khoảng trắng.
 * "Đổ CÀ-PHÊ!!" -> "do ca phe"
 */
export function foldVietnamese(input: string): string {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Từ khoá khớp theo ranh giới từ trên chuỗi đã fold. */
export function containsKeyword(foldedText: string, keyword: string): boolean {
  const kw = foldVietnamese(keyword);
  if (!kw) return false;
  return ` ${foldedText} `.includes(` ${kw} `);
}
