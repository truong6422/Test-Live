# Prompt tạo ảnh bối cảnh — "Sếp ơi em xin nghỉ!"

Ảnh làm xong thì bỏ vào thư mục `C:\Users\dev\OneDrive\Pictures\Truong` (hoặc gửi trực tiếp).
Riêng ảnh nền 1 đặt thẳng vào `apps/overlay/public/sprites/bg/office.png` là overlay tự dùng; không có ảnh này thì overlay giữ phòng vẽ tay.
Sau khi có ảnh, cần căn lại toạ độ trong code (cây, cầu dao, WC, bàn Sếp, chỗ ngồi) cho khớp với ảnh.

Phong cách chung (giống nhân vật hiện có): pixel art 16-bit, nét viền đen rõ, màu ấm, góc nhìn thẳng chính diện (hơi từ trên xuống), **không có người, không có chữ**.

---

## 1b. (KHUYÊN DÙNG — thay cho mục 1) Chỉ vẽ bức tường + bục Sếp — ngang 16:9, 1920×1080

Lần tạo đầu (mục 1) đúng phong cách nhưng sai tỉ lệ: thảm phòng ban quá thấp, cửa sổ chiếm chỗ cửa WC, cửa thoát hiểm chiếm chỗ cây.
Công cụ tạo ảnh khó giữ đúng tỉ lệ cả khung dọc, nên chỉ nhờ vẽ phần tường; sàn gỗ + thảm phòng ban do game tự vẽ (lấy màu theo ảnh lần 1).
```
Pixel art, 16-bit retro game style, wide landscape image 1920x1080 pixels (16:9).
A straight-on front view of the back wall of a cozy modern office, like a side-view game level, flat perspective, no vanishing point.
Warm cream wallpaper with thin vertical stripes, wooden wainscoting panels along the lower part of the wall.
The bottom fifth of the image is a raised wooden stage floor made of dark brown planks, with a straight horizontal front edge along the bottom of the image.
A thin ceiling trim runs along the top of the image with three flat ceiling lights evenly spaced, casting soft light cones onto the wall.

Objects from left to right, all standing on or mounted above the wooden stage:
1. At the far left edge: a narrow wooden emergency exit door standing on the stage, with a small plain green sign above it.
2. Next to it: a stretch of empty plain wall with nothing on the floor in front of it, and a round white wall clock hanging high on the wall.
3. A small grey electrical breaker box mounted on the wall at about chest height, with an empty slot in the middle where a lever would go.
4. In the middle: a large whiteboard on the wall showing a simple blue bar chart with a red arrow going down. The stage floor in front of the whiteboard is completely empty.
5. A blue restroom door standing on the stage, with a small white toilet pictogram on it.
6. At the far right: a window with half-open blinds showing a sunny city skyline.

Clean dark pixel outlines, soft warm colors, cheerful mood.
No people, no characters, no animals, no furniture on the stage, no text, no letters, no numbers, no words on signs.
```

---

## 1. Ảnh nền văn phòng — dọc 9:16, 1080×1920 (bản đầu, đã thay bằng 1b)

```
16-bit pixel art background of a cozy modern Vietnamese startup office, vertical 9:16 portrait, 1080x1920,
straight-on front view with a slight top-down angle, clean dark outlines, warm lighting, cute game style,
NO people, NO characters, NO text, NO letters anywhere.

Layout from top to bottom (percent of image height):
- 0%–15%: plain dark navy ceiling band (will be covered by UI), no details.
- 15%–37%: back wall with cream wallpaper and wooden wainscoting on the lower part.
  * far left (x 3%–12%): a wooden emergency exit door with a blank green sign above it, door bottom at 40%.
  * left (x 18%–25%, y 19%–24%): a round wall clock.
  * x 25%–31%, y 24%–28%: a small grey electrical breaker box mounted on the wall (empty slot for a lever, no lever).
  * center (x 30%–70%, y 18%–31%): a large whiteboard with a simple blue bar chart and a red falling trend line, blank title area at the top.
  * right (x 80%–98%, y 18%–29%): a big window with blinds showing a sunny city skyline.
  * keep the wall EMPTY at x 8%–30% below y 28% (a bonsai pot will be placed there) and at x 66%–79% (a toilet door will be placed there).
- 36%–41%: a raised dark wooden platform across the full width (the boss stands here); keep the center x 33%–67% empty (the boss desk will be placed there).
- 41%–89%: open-plan office floor with light wooden planks, divided into 4 equal vertical carpet zones side by side,
  colored soft blue, soft orange, soft green, soft purple, each with a thick border of the same hue
  and a blank colored plaque at its top edge (around y 42%–44%). Carpets are EMPTY (desks will be added by the game).
- 89%–100%: wooden floor with a water cooler at the far left, a potted plant, a printer on a cabinet at the far right; center left clear.
```

Nếu công cụ không nhận 1080×1920 thì tạo 9:16 lớn hơn (ví dụ 1440×2560), overlay tự co lại.

---

## 2. Đồ vật rời (tuỳ chọn — để khớp phong cách với ảnh nền)

Mỗi món vẽ trên **nền một màu phẳng #FF00FF (hồng tím)**, không bóng đổ ra nền, không chữ, cùng phong cách pixel art 16-bit như trên.

**Bàn Sếp**
```
16-bit pixel art sprite, front view of a large executive wooden office desk with a blank golden name plate on the front,
a computer monitor on the left and a small desk lamp, clean dark outlines, flat solid #FF00FF background, no text, no people.
```

**Bàn nhân viên** (dùng lặp lại cho cả 100 chỗ nên càng đơn giản càng tốt)
```
16-bit pixel art sprite, front view of a small simple office desk seen from the front, light wood top, darker front panel with blank space for a name tag,
a small laptop on top, clean dark outlines, flat solid #FF00FF background, no text, no people.
```

**Cửa WC** (2 trạng thái trên cùng một ảnh: bình thường / bị khoá bằng ổ khoá to)
```
16-bit pixel art sprite sheet, two frames side by side: a blue office restroom door (front view) with a toilet icon instead of text,
and the same door locked with a huge yellow padlock and chain, clean dark outlines, flat solid #FF00FF background, no text.
```

**Hộp cầu dao** (2 trạng thái: cần gạt lên / gạt xuống)
```
16-bit pixel art sprite sheet, two frames side by side: a grey wall-mounted electrical breaker box with a big red lever pointing UP,
and the same box with the lever pointing DOWN and small sparks, clean dark outlines, flat solid #FF00FF background, no text.
```
