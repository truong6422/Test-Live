# ĐI CÂU THÔI! — thiết kế trò chơi câu cá (TikTok LIVE)

Thay hoàn toàn chủ đề văn phòng "Sếp ơi em xin nghỉ!". Kiến trúc giữ nguyên (Bun + Hono + WS server, PixiJS overlay 1080×1920, React admin, Postgres/memory store). Kiểu dữ liệu chung: `packages/shared/src/types.ts` (gói `@cau/shared`) — **đó là hợp đồng, không tự ý đổi**.

## ⚠️ LUẬT CHƠI CHÍNH (bản sửa theo yêu cầu chủ phòng — ưu tiên hơn mọi mục bên dưới nếu mâu thuẫn)

1. **Bố cục**: hồ câu ở giữa màn hình. Người xem ngồi câu ở **hai bên bờ** (bờ trái, bờ phải, xếp dọc theo mép hồ) và **chiếu giữa trước mặt hồ** (bờ gần, phía dưới, giữa màn hình — `fishing.frontSeats` ghế, mặc định 5, to và nổi bật hơn).
2. **Ai ngồi chiếu giữa**: người **tặng quà nhiều nhất trong phiên**, hoà thì người **câu lâu nhất** (`fishingMs`). Server tính lại mỗi chu kỳ và gán `RosterMember.seat = 'front' | 'left' | 'right'` (người còn lại chia đều hai bên, ổn định theo hash ID để không nhảy chỗ). Overlay chỉ hiển thị theo `seat`. Bỏ khái niệm "4 bến".
3. **Vào câu bằng bình luận**: BẤT KỲ bình luận nào cũng đưa người xem vào hồ (vào roster, tối đa 100). Tặng quà cũng vào. Không tương tác quá `fishing.idleKickMs` (mặc định 10 phút) thì rời hồ.
4. **Câu tự động mỗi 5 giây** (`fishing.tickMs = 5000`): mỗi người đang ngồi lên **1 con cá** bốc từ `fishing.loot` (bảng loot ở mục "Việc câu"). Server gửi gộp **một** tin `{ type: 'catches', data: CatchEvent[] }` mỗi chu kỳ; overlay cho từng cần thủ giật cần, cá nhỏ bay lên kèm số kg (lệch pha ngẫu nhiên trong 5s cho đỡ đồng loạt). Mỗi con cộng kg + điểm (`fishingMs` cộng dồn).
5. **Cá to**:
   - **Định kỳ**: cứ `fishing.bigFishEveryMs` (mặc định 180000 = 3 phút) có "CÁ TO XUẤT HIỆN!" — server chọn ngẫu nhiên một người đang ngồi (ưu tiên x2 cho chiếu giữa) và chạy hành động `fishing.bigFishActionId` (mặc định `big_fish_event`). `snapshot.nextBigFishAt` + tin `bigfish.next` để HUD đếm ngược.
   - **Tặng quà**: người tặng được **kéo cá to** ngay, loài cá to theo giá trị kim cương (bảng dưới). Server bốc cân trong `ActionConfig.fish` và gửi `RunningAction.fish = { emoji, name, kg }`; kg cộng vào người đó.
   - **Hiệu ứng hoành tráng**: cần cong vút, dây căng rung, nước xoáy, bọt tung, rung màn hình, cá nhảy khỏi mặt nước xoay vòng, băng rôn tên + cân nặng to giữa màn hình, pháo hoa / tia sáng, cả hồ cổ vũ. Cá càng to (bậc càng cao) hiệu ứng càng dài và lớn.
6. **Hai bảng**: **BẢNG CÂN CÁ** (`kgBoard`, xếp theo tổng kg trong phiên) và **TOP QUÀ TẶNG** (`leaderboard`, theo kim cương). Tin `leaderboard` mang cả hai.
7. Cá Thần không còn là boss có thanh máu trên HUD: `KingState`/`kingEffect` vẫn còn trong kiểu dữ liệu (giữ nguyên, server vẫn tính) nhưng **HUD không hiển thị thanh Cá Thần**. "Cá Thần huyền thoại" là loài cá to bậc cao nhất.

### Tuân thủ chính sách TikTok LIVE (từ báo cáo nghiên cứu 03/11/2026)

- Quà → loài cá **cố định theo bậc** (không có "cơ hội/tỉ lệ trúng"). Cá to định kỳ chọn **đều** trong số người đang ngồi, KHÔNG ưu tiên người tặng quà.
- Không giải thưởng giá trị thật; overlay luôn ghi "Điểm chỉ để vui, không quy đổi".
- Câu chữ trung tính, không xin quà lặp lại / nhấp nháy / thúc giục.
- Demo bị khoá khi đang kết nối TikTok thật; demo luôn có nhãn DEMO to.
- Tên / bình luận hiển thị đi qua bộ lọc.
- Chủ phòng nên có mặt (cam/mic, dẫn trực tiếp), không treo máy nhiều giờ.

### Hành động kéo cá to (thay bảng hành động cũ ở dưới)

| Từ 💎 | ID | Tên | Cá | kg | ms | points |
|---:|---|---|---|---|---:|---:|
| 1 | `pull_carp` | Kéo cá chép to | 🐟 Cá chép to | 3–6 | 5000 | 5 |
| 5 | `pull_grass_carp` | Kéo cá trắm cỏ | 🐠 Cá trắm cỏ | 6–12 | 6000 | 10 |
| 10 | `pull_catfish` | Kéo cá trê khổng lồ | 🐡 Cá trê khổng lồ | 10–20 | 7000 | 10 |
| 30 | `pull_snakehead` | Kéo cá lóc bông | 🐟 Cá lóc bông | 15–25 | 7000 | 12 |
| 99 | `pull_giant_catfish` | Kéo cá lăng khủng | 🦈 Cá lăng khủng | 25–50 | 8000 | 15 |
| 199 | `pull_arowana` | Kéo cá rồng vàng | 🐉 Cá rồng vàng | 40–70 | 9000 | 20 |
| 299 | `pull_stingray` | Kéo cá đuối nước ngọt | 🦈 Cá đuối khổng lồ | 60–120 | 10000 | 25 |
| 499 | `pull_legend` | Kéo Cá Thần huyền thoại | 👑 Cá Thần huyền thoại | 150–300 | 12000 | 40 |
| Heart Me 7934 | `pull_koi` | Kéo cá Koi | 🎏 Cá Koi đỏ trắng | 2–5 | 5000 | 3 |
| định kỳ | `big_fish_event` | Cá to xuất hiện! | 🐋 Cá to bí ẩn | 8–30 | 8000 | 10 |
| tập thể | `grand_haul` | Cả hồ kéo Cá Thần | 👑 Cá Thần | 200–400 (chia đều cho người góp sức) | 12000 | 0 |

Tất cả lanes = `['king','lake']` (riêng `pull_legend`, `pull_stingray`, `grand_haul`: mọi lane). Cooldown toàn cục 0, mỗi người 0 (quà luôn chạy, xếp hàng). Mapping quà mặc định: 7934 → `pull_koi`, các bậc giftId 0 theo bảng. Upgrade v≤2: id văn phòng cũ map sang id mới theo thứ tự bậc (throw_paper→pull_carp, pluck_tree→pull_grass_carp, doodle_kpi→pull_catfish, complaint_call→pull_snakehead, crash_pc→pull_giant_catfish, lock_toilet→pull_arowana, flat_tire→pull_stingray, blackout→pull_legend, praise_boss→pull_koi, strike→grand_haul).

Việc câu bằng bình luận (`work`) giờ chỉ là biểu cảm vui (thay mồi, trà đá, hát hò, khoe cá, ngủ gật); **bỏ việc `cau_ca` và loot khỏi work** — loot chuyển sang `fishing.loot`.

### CSDL

Lưu cân cá toàn thời gian cần cột mới → **đúng MỘT migration mới** `apps/server/src/db/migrations/0001_fishing.sql` (+ snapshot/journal Drizzle): `players.total_grams integer not null default 0`, `session_players.grams integer not null default 0` (lưu gram để là số nguyên). Không sửa `0000_init.sql`. Nếu cần đổi CSDL thêm thì gộp vào `0001_fishing.sql`.

---

## (Thiết kế ban đầu — phần nào mâu thuẫn với mục trên thì bỏ)

## Bối cảnh

Một hồ nước giữa làng quê lúc chiều tà. Người xem là **cần thủ** ngồi câu trên **4 bến** quanh hồ. Giữa hồ có **Cá Thần** (cá trê khổng lồ râu dài, đeo vảy vàng) — "boss" của game, thay vai trò Sếp.

- 4 bến (thay 4 phòng ban): `Bến Lau Sậy`, `Bến Cầu Gỗ`, `Bến Cây Si`, `Bến Đá Ong` — mỗi bến một màu áo.
- Chỗ ngồi tự giãn theo số người (32 → 48 → 72 → 112), tối đa hiển thị 100 (`ROSTER_MAX`).
- Chưa follow: thẻ **TẬP SỰ**. Đã follow: thẻ **CẦN THỦ**, đội nón lá (thay cà vạt).
- Bố cục tránh vùng giao diện TikTok che trên điện thoại (giữ như bản cũ: chừa mép trên ~ 220px, mép dưới ~ 380px, mép phải ~ 140px cho HUD/nút TikTok).

## Cá Thần (KingState)

- `calm` 0..100 (bình thản) và `stamina` 0..100 (sức bền), hồi dần theo `KingConfig` (`calmRecoveryPerSec`, `staminaRecoveryPerSec`, `exhaustedMs`).
- `mood` theo calm: ≥80 `calm` (Lững lờ), ≥60 `curious` (Tò mò), ≥35 `agitated` (Cáu kỉnh), ≥15 `thrashing` (Quẫy dữ dội), còn lại / stamina = 0 → `exhausted` (Kiệt sức — nổi bụng lên mặt nước, ai cũng giật được).
- Tin nhắn WS `{ type: 'king', data: KingState }`; snapshot có trường `king`.

## Hành động — chỉ bằng quà (theo giá trị kim cương)

Chạy lần lượt từng cái (maxConcurrent = 1). Cần thủ của chính người tặng đứng dậy rời bến, đi/chèo tới chỗ diễn rồi quay về.

| Từ 💎 | ID | Tên | Diễn ra | Lanes | Tác động (calm, stamina) | ms |
|---:|---|---|---|---|---|---:|
| 1 | `toss_bait` | Ném mồi trêu Cá Thần | ném viên mồi trúng đầu Cá Thần, nó trợn mắt | king | -4, -2 | 3000 |
| 5 | `ground_bait` | Rải thính | vung nắm thính, đàn cá nhỏ xúm lại, Cá Thần ghen tị | king, lake | -7, -3 | 7000 |
| 10 | `shiny_lure` | Mồi giả lấp lánh | thả mồi giả phát sáng, Cá Thần đớp hụt | king | -8, -3 | 7000 |
| 30 | `drum_boat` | Gõ mạn thuyền | khua chiêng/gõ mạn thuyền ầm ĩ, sóng âm toả ra, Cá Thần bịt tai | king, lake | -9, -3 | 6000 |
| 99 | `cast_net` | Quăng chài | chài tròn bung ra chụp Cá Thần, nó vùng thoát | king, lake | -8, -4 | 8000 |
| 199 | `summon_storm` | Gọi mưa giông | mây đen, sấm chớp, mưa xối, cả hồ tối lại, Cá Thần choáng | king, sky | -12, -8 | 8000 |
| 299 | `dive_bottom` | Lặn xuống đáy hồ | **cảnh cắt** xuống đáy hồ: cần thủ đeo kính lặn rút râu Cá Thần | king, lake, dock, sky, underwater | -10, -5 | 9000 |
| 499 | `open_floodgate` | Mở cống xả lũ | nước dâng, sóng lớn cuốn Cá Thần xoay vòng, cả bến ướt sũng | king, lake, dock | -10, -6 | 8000 |
| — | `feed_king` | Cho Cá Thần ăn bánh mì | (Heart Me, giftId 7934) — Cá Thần dịu lại | king | +6, +2 | 5000 |
| tập thể | `grand_haul` | Cả hồ kéo Cá Thần | mọi cần thủ cùng kéo một sợi dây, Cá Thần bị lôi lên bờ rồi được thả lại | tất cả lane | -40, -30 | 9000 |

Điểm (`points`): toss 5, ground 10, shiny 10, drum 10, net 10, storm 12, dive 12, flood 12, feed 3, haul 0. Priority, cooldown giữ như bậc tương ứng của bản cũ (throw_paper→toss_bait, pluck_tree→ground_bait, doodle_kpi→shiny_lure, complaint_call→drum_boat, crash_pc→cast_net, lock_toilet→summon_storm, flat_tire→dive_bottom, blackout→open_floodgate, praise_boss→feed_king, strike→grand_haul).

Mapping quà mặc định: `7934 Heart Me → feed_king`, các bậc giftId 0: 1/5/10/30/99/199/299/499 như bảng trên.

**Nâng cấp cấu hình cũ**: `CONFIG_VERSION = 3`. Cấu hình đã lưu bản ≤ 2 (chủ đề văn phòng): đổi id hành động cũ sang id mới theo cặp ở trên (giữ cooldown/priority… admin đã chỉnh, đặt lại `name` sang tên mới), đổi `actionId` trong mapping quà và collective tương ứng, thay danh sách `work` bằng mặc định câu cá, đổi tên/mô tả/rewardTitle sự kiện tập thể sang mặc định mới. Trong store, khoá settings `boss` cũ được đọc làm `king` nếu chưa có `king`.

## Sự kiện tập thể

`Cả hồ kéo Cá Thần` — mỗi bình luận / hành động góp 1 phần, mục tiêu 100, chạy `grand_haul`. Danh hiệu thưởng: `Kẻ săn Cá Thần`.

## Việc câu miễn phí (bình luận) — `WorkTask`

| ID | Tên | Từ khoá | Emoji | Câu nói | Điểm | Loot |
|---|---|---|---|---|---:|---|
| `cau_ca` | Câu cá | `cau`, `cau ca`, `quang can`, `giat` | 🎣 | `Dính rồi! {name} {kg}kg` | 2 | có (bảng dưới) |
| `thay_moi` | Thay mồi | `thay moi`, `moc moi`, `moi` | 🪱 | Mồi giun xịn đây! | 1 | — |
| `uong_tra` | Uống trà đá | `tra da`, `uong tra`, `nghi` | 🍵 | Làm cốc trà đá đã... | 1 | — |
| `khoe_ca` | Khoe cá | `khoe`, `song ao`, `check in` | 📸 | Cá to chưa anh em! | 2 | — |
| `hat_ho` | Hát hò | `hat`, `hat ho`, `ca hat` | 🎵 | Ơi à ơi... cá ơi lên đi! | 1 | — |
| `ngu_gat` | Ngủ gật | `ngu`, `buon ngu`, `ngu gat` | 😴 | Zzz... cá cắn câu thì gọi nhé | 1 | — |

Loot của `cau_ca` (weight, kg, điểm thưởng):
🐟 Cá rô 30, 0.1–0.5, 0 · 🐠 Cá chép 22, 0.5–3, 1 · 🐡 Cá trắm 12, 2–8, 3 · 🦐 Tôm càng 12, 0.05–0.2, 1 · 🐢 Rùa (thả lại) 4, 1–5, 2 · 🥾 Chiếc ủng rách 10, 0–0, 0 · 🧦 Chiếc tất thối 6, 0–0, 0 · 🦈 Cá lăng khủng 3, 10–30, 10 · 👑 Cá Koi vàng 1, 3–6, 25.

Server bốc ngẫu nhiên theo trọng số (cân làm tròn 1 chữ số thập phân), gửi `WorkEvent.catch` và `points` thực nhận. Cooldown mỗi người: `cau_ca` 8s, các việc khác 20s.

## Danh hiệu cần thủ (`PlayerTitle.id`)

`rookie` Cần thủ tập sự (mặc định) · `angler` Cần thủ chăm chỉ (≥ 20 lần câu) · `big_catch` Sát thủ cá to (từng câu ≥ 10 kg — đếm lượt loot ≥ 10kg trong `actionCounts['big_catch']`) · `troll` Kẻ phá hồ (≥ 10 lượt hành động quà) · `king_hunter` Kẻ săn Cá Thần (nhận từ sự kiện tập thể).

## Bảng xếp hạng

"TOP CẦN THỦ": xếp theo tổng kim cương đã tặng, rồi điểm, rồi số lượt tham gia (giữ logic cũ).

## Demo

Demo connector sinh tên người xem kiểu cần thủ, bình luận theo từ khoá việc câu ("câu", "thay mồi", "trà đá"…), và quà đủ mọi bậc kim cương.

## CSDL

**Không đổi schema / không thêm migration.** Cột `actions.boss_effect` vẫn giữ tên trong SQL, phía Drizzle đặt field `kingEffect: jsonb('boss_effect')`. Mặc định cột `players.title` trong SQL giữ nguyên (code luôn ghi title).

## Overlay

Hợp đồng giữa phần cảnh và phần hoạt ảnh: `apps/overlay/src/scene/contract.ts`. Không có ảnh sprite — mọi thứ vẽ pixel bằng PixiJS `Graphics` (phong cách 16-bit, viền đậm `INK`, ấm áp lúc hoàng hôn). Giữ các nguyên tắc hiệu năng (`antialias: false`, 30 FPS, `cacheAsTexture` cho lớp tĩnh, `GraphicsContext` dùng chung).
