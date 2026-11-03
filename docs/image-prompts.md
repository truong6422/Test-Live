# Prompt tạo ảnh tham khảo — "ĐI CÂU THÔI!"

> **Lưu ý:** overlay hiện **không tải ảnh nào**. Mọi hình ảnh (hồ, cần thủ, cá, Cá Thần, hiệu ứng) đều vẽ bằng code (PixiJS `Graphics`). Các prompt dưới đây chỉ để dành cho trường hợp sau này muốn thay bằng pixel art vẽ sẵn. Khi đó cần viết thêm code nạp ảnh, căn lại toạ độ trong `apps/overlay/src/scene/` (mặt nước, bờ trái/phải, chiếu giữa, chỗ Cá Thần) và giữ đúng hợp đồng `apps/overlay/src/scene/contract.ts`.

Phong cách chung (khớp với hình vẽ bằng code hiện tại): pixel art 16-bit, nét viền đen đậm rõ, màu ấm lúc hoàng hôn, làng quê Việt Nam, góc nhìn thẳng chính diện (hơi từ trên xuống), **không có chữ**. Sprite rời vẽ trên **nền một màu phẳng #FF00FF (hồng tím)**, không bóng đổ ra nền, để dễ tách nền.

Nhớ chừa vùng giao diện TikTok che trên điện thoại khi bố trí khung dọc: mép trên ~220 px, mép dưới ~380 px, mép phải ~140 px (trong khung 1080×1920).

---

## 1. Ảnh nền hồ câu — ngang 16:9, 1920×1080, nhìn chính diện

Công cụ tạo ảnh khó giữ đúng tỉ lệ khung dọc, nên tạo ảnh ngang rồi game tự cắt/co và vẽ thêm phần bờ gần.

```
Pixel art, 16-bit retro game style, wide landscape image 1920x1080 pixels (16:9).
A straight-on front view of a peaceful Vietnamese countryside fishing lake at sunset, like a side-view game level, flat perspective.
Top third: warm orange and pink sunset sky with soft pixel clouds, a far shoreline with bamboo groves, a few thatched village houses,
coconut palms and a small stone floodgate on the far bank.
Middle: a wide calm lake surface reflecting the sunset, gentle pixel ripples, a few lotus pads and reeds near the edges,
a small empty woven bamboo basket boat moored at the right side.
Bottom fifth: the near grassy bank with a straight horizontal edge, left and right sides slightly raised with earthen banks
and wooden stakes, the center of the near bank flat and empty (a bamboo mat will be placed there).
Keep the center of the lake completely empty (a giant fish will appear there).
Clean dark pixel outlines, warm cozy colors, cheerful mood.
No people, no characters, no fish, no animals, no text, no letters, no numbers.
```

---

## 2. Cá Thần — sprite sheet

Cá trê khổng lồ râu dài, vảy vàng — cũng là "Cá Thần huyền thoại" (`pull_legend`, `grand_haul`).

```
16-bit pixel art sprite sheet, a giant legendary Vietnamese catfish with long flowing whiskers, dark olive body,
shining golden scales on its back and a small golden crown-like fin, big expressive cartoon eyes, side view facing left.
One row of 8 equal frames, evenly spaced: 1-2 calm swimming, 3 curious peeking up, 4 angry tail splash,
5 thrashing wildly with water drops, 6 belly-up exhausted, 7 jumping out of the water curved in the air,
8 hooked and pulled with mouth open.
Clean thick dark outlines, warm colors, flat solid #FF00FF background, no shadow on background, no text.
```

---

## 3. Cần thủ — sprite sheet

Dùng lặp lại cho tới 100 người, nên càng đơn giản càng tốt. Áo trắng/xám nhạt để game tô lại màu; một biến thể đội nón lá (thẻ **CẦN THỦ**, đã follow), một biến thể đầu trần (thẻ **TẬP SỰ**).

```
16-bit pixel art sprite sheet of a small chibi Vietnamese villager angler, plain light grey shirt and dark shorts, holding a bamboo fishing rod.
Two rows: top row wearing a conical non la hat, bottom row bare-headed. Each row has 8 equal frames, evenly spaced:
1 sitting on a small stool holding the rod, 2 rod twitching, 3 yanking the rod up, 4 holding up a small fish proudly,
5 standing and pulling hard with the rod bent, 6 cheering with arms up, 7 sipping a glass of iced tea, 8 dozing off.
Front-facing, slight three-quarter view. Clean dark outlines, flat solid #FF00FF background, no text.
```

---

## 4. Cá to rời (tuỳ chọn)

Mỗi loài một ảnh, cùng phong cách, nằm nghiêng hướng trái, uốn cong như đang nhảy khỏi mặt nước:

```
16-bit pixel art sprite, a single <LOÀI CÁ> leaping out of the water, curved body, side view facing left,
clean thick dark outlines, warm saturated colors, small water splash drops around, flat solid #FF00FF background, no text.
```

Thay `<LOÀI CÁ>` lần lượt: `big common carp`, `grass carp`, `giant catfish`, `spotted snakehead fish`, `giant Mekong catfish`, `golden arowana`, `giant freshwater stingray`, `lucky red and white koi`.

---

## 5. Cảnh dưới nước — dọc 9:16, 1080×1920 (tuỳ chọn)

Cho các hiệu ứng kéo cá bậc cao (nhìn xuyên xuống nước khi cá to vùng vẫy).

```
16-bit pixel art background, vertical 9:16 portrait 1080x1920, underwater view of a Vietnamese freshwater lake bottom at sunset.
Top edge: the wavy water surface seen from below with warm orange light rays streaming down.
Middle: murky green-blue water with floating bubbles and a few drifting leaves, keep the center large area EMPTY (a giant fish will be placed there).
Bottom: muddy lake bed with water plants, smooth rocks, an old sunken clay pot and an old rubber boot.
Clean dark pixel outlines, soft dreamy colors.
No people, no fish, no characters, no text, no letters.
```

Nếu công cụ không nhận đúng kích thước thì tạo cùng tỉ lệ ở kích thước lớn hơn, game tự co lại.

## Cần thủ — `apps/overlay/public/sprites/anglers.png`

Lưới 3×3, nền magenta, không vạch kẻ ô; hàng 1–2 = 6 người ngồi ghế đẩu nhìn sang PHẢI (bờ phải tự lật), hàng 3 = 3 người nhìn thẳng (chiếu VIP). Cần câu do code vẽ, nắm tay ≈ 0,43 bề rộng / 0,6 chiều cao tính từ giữa mép dưới. Xoá dấu ✦ góc dưới phải, thu về 1024² (nearest-neighbour).

```
Create an image: pixel art sprite sheet, 3x3 grid, solid magenta #FF00FF background, no grid lines, no text. 9 different cute Vietnamese people sitting on small wooden stools, full body. Rows 1-2: six people in side view facing RIGHT, arms stretched forward holding nothing (as if holding a fishing rod). Row 3: three people facing the viewer, sitting, one hand forward. Varied clothes, hats (conical hat, cap, bucket hat), men and women. 16-bit game style, thick dark outline.
```
