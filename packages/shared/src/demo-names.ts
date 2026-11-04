/**
 * Tên giả kiểu tài khoản TikTok Việt (tên hiển thị có emoji, @handle, user + số…) cho CHẾ ĐỘ DEMO / XEM TRƯỚC.
 * Chỉ để thử giao diện trông như phiên LIVE thật. Sự kiện demo luôn mang source = 'demo' + nhãn DEMO trên overlay,
 * và server không cho bật demo khi đang nối TikTok LIVE thật — không dùng để giả người xem trước khán giả thật.
 */
const GIVEN = [
  'Ngọc Ánh', 'Minh Thư', 'Hoàng Long', 'Tuấn Anh', 'Thu Trang', 'Quốc Bảo', 'Khánh Linh', 'Đức Huy', 'Phương Vy', 'Gia Hân',
  'Thành Đạt', 'Bảo Ngọc', 'Trọng Nhân', 'Mỹ Duyên', 'Văn Toàn', 'Hải Yến', 'Nhật Minh', 'Thanh Tâm', 'Công Phượng', 'Lan Anh'
];
const HANDLE = [
  'tuananh', 'linhh', 'minhthu', 'longpro', 'trang.xinh', 'huy.dz', 'baongoc', 'vyvy', 'datnguyen', 'hanie',
  'toan.ca', 'yen.nhi', 'kenzz', 'bong.bep', 'tamtam', 'quan.bui', 'mai.ly', 'tung.son', 'thao.my', 'pnhi'
];
const NICK = [
  'Bé Bông', 'Cún Con', 'Mít Ướt', 'Tèo Em', 'Gấu Mập', 'Su Su', 'Bí Đỏ', 'Ốc Nhỏ', 'Heo Hồng', 'Tôm Hùm',
  'Chú Ba Câu Cá', 'Anh Tư Miền Tây', 'Cô Út', 'Bà Tám', 'Thím Năm', 'Ông Bảy Cần Câu'
];
const EMOJI = ['🌸', '✨', '🐉', '🐟', '🎣', '💕', '🍀', '😎', '🌙', '🔥', '🐶', '🦋'];
const SUFFIX = ['99', '2k5', '2k3', '_04', '.vn', '123', '_official', '.88', '2k7', '_hp'];

/** Băm nguyên ổn định (cùng i → cùng tên). */
function mix(i: number): number {
  let h = (i + 1) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Tên demo thứ i (0, 1, 2…): xoay vòng 5 kiểu tên, không lặp trong vài trăm tên đầu. */
export function demoName(i: number): string {
  const h = mix(i);
  const pick = <T>(arr: readonly T[], shift: number) => arr[(h >>> shift) % arr.length]!;
  switch (i % 5) {
    case 0:
      return `${pick(GIVEN, 3)} ${pick(EMOJI, 11)}`;
    case 1:
      return `${pick(HANDLE, 5)}${pick(SUFFIX, 17)}`;
    case 2:
      return pick(NICK, 7) + (h % 3 === 0 ? ` ${pick(EMOJI, 19)}` : '');
    case 3:
      return `user${1000000 + (h % 8999999)}`;
    default:
      return pick(GIVEN, 9);
  }
}

/** n tên demo khác nhau (bỏ tên trùng). */
export function demoNames(n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < n && i < n * 20; i++) {
    const name = demoName(i);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
