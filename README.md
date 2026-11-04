# ĐI CÂU THÔI!

Trò chơi câu cá tương tác cho **TikTok LIVE**. Người xem là **cần thủ** ngồi câu quanh một hồ nước làng quê lúc chiều tà: **bình luận** để vào hồ và câu tự động, **tặng quà** để kéo ngay một con **cá to** (quà càng to, cá càng khủng, hiệu ứng càng hoành tráng). Hình ảnh chạy trên overlay dọc 1080×1920 (gắn vào OBS); chủ phòng điều khiển qua dashboard.

Thiết kế chi tiết: `docs/fishing-design.md`.

## Tính năng

**Vào hồ bằng bình luận, câu tự động.** Bất kỳ bình luận nào (hoặc tặng quà) cũng đưa người xem vào hồ, tối đa 100 người (`ROSTER_MAX`). Cứ mỗi `fishing.tickMs` (mặc định **5 giây**) mỗi người đang ngồi lên **1 con cá** bốc ngẫu nhiên từ bảng `fishing.loot`. Server gửi gộp **một** tin `{ type: 'catches', data: CatchEvent[] }` mỗi chu kỳ; overlay cho từng cần thủ giật cần, cá nhỏ bay lên kèm số kg (lệch pha ngẫu nhiên trong chu kỳ cho đỡ đồng loạt). Mỗi con cộng kg + điểm, thời gian câu cộng dồn vào `fishingMs`. Không bình luận / tặng quà quá `fishing.idleKickMs` (mặc định 10 phút) thì rời hồ.

**Bảng cá thường** (`fishing.loot`, bốc theo trọng số, cân làm tròn 1 chữ số thập phân):

| Cá | Trọng số | Cân (kg) | Điểm thưởng |
|----|---------:|---------:|------------:|
| 🐟 Cá rô | 30 | 0.1–0.5 | 0 |
| 🐠 Cá chép | 22 | 0.5–3 | 1 |
| 🐡 Cá trắm | 12 | 2–8 | 3 |
| 🦐 Tôm càng | 12 | 0.05–0.2 | 1 |
| 🐢 Rùa (thả lại) | 4 | 1–5 | 2 |
| 🥾 Chiếc ủng rách | 10 | 0 (rác) | 0 |
| 🧦 Chiếc tất thối | 6 | 0 (rác) | 0 |
| 🦈 Cá lăng khủng | 3 | 10–30 | 10 |
| 👑 Cá Koi vàng | 1 | 3–6 | 25 |

**Chỗ ngồi: hai bên bờ và Bến Vàng.** Hồ câu ở giữa màn hình. Cần thủ ngồi dọc **bờ trái**, **bờ phải** và **Bến Vàng** trước mặt hồ (bờ gần, giữa màn hình, `fishing.frontSeats` ghế, mặc định 5, to và nổi bật hơn). Bến Vàng dành cho người **tặng quà nhiều nhất trong phiên**, hoà thì người **câu lâu nhất** (`fishingMs`). Server tính lại mỗi chu kỳ và gán `RosterMember.seat = 'front' | 'left' | 'right'`; người còn lại chia đều hai bên, ổn định theo hash ID nên không nhảy chỗ. Overlay chỉ hiển thị theo `seat`. Bố cục chừa các vùng giao diện TikTok che trên điện thoại (mép trên ~220 px, mép dưới ~380 px, mép phải ~140 px).

**Tặng quà = kéo cá to ngay.** Người tặng quà được kéo một con cá to, loài cá theo **giá trị** quà: tổng giá trị = kim cương của một món × số lượng (sau khi gộp combo). Server bốc cân trong khoảng `ActionConfig.fish` rồi gửi `RunningAction.fish = { emoji, name, kg }`; số kg cộng vào người đó. Hiệu ứng: cần cong vút, dây căng rung, nước xoáy, bọt tung, rung màn hình, cá nhảy khỏi mặt nước xoay vòng, băng rôn tên + cân nặng giữa màn hình, pháo hoa, cả hồ cổ vũ. Bậc càng cao, hiệu ứng càng dài và lớn. Hành động chạy **lần lượt từng cái một** (`maxConcurrent = 1`): cái trước diễn xong thì cái sau (đang chờ trong hàng đợi) mới bắt đầu.

| Từ (kim cương) | ID | Hành động | Cá | Cân (kg) | Thời lượng | Điểm | Ví dụ quà |
|---:|----|-----------|----|---------:|-----------:|-----:|-----------|
| 1 | `pull_carp` | Kéo cá chép to | 🐟 Cá chép to | 3–6 | 5 s | 5 | Rose, TikTok, GG |
| 5 | `pull_grass_carp` | Kéo cá trắm cỏ | 🐠 Cá trắm cỏ | 6–12 | 6 s | 10 | Finger Heart, Rose ×5 |
| 10 | `pull_catfish` | Kéo cá trê khổng lồ | 🐡 Cá trê khổng lồ | 10–20 | 7 s | 10 | Rose ×10, Perfume (20) |
| 30 | `pull_snakehead` | Kéo cá lóc bông | 🐟 Cá lóc bông | 15–25 | 7 s | 12 | Doughnut |
| 99 | `pull_giant_catfish` | Kéo cá lăng khủng | 🦈 Cá lăng khủng | 25–50 | 8 s | 15 | Hat and Mustache |
| 199 | `pull_arowana` | Kéo cá rồng vàng | 🐉 Cá rồng vàng | 40–70 | 9 s | 20 | Hat and Mustache ×2–3 |
| 299 | `pull_stingray` | Kéo cá đuối nước ngọt | 🦈 Cá đuối khổng lồ | 60–120 | 10 s | 25 | Corgi |
| 499 | `pull_legend` | Kéo Cá Thần huyền thoại | 👑 Cá Thần huyền thoại | 150–300 | 12 s | 40 | Money Gun (500) |
| — | `pull_koi` | Kéo cá Koi | 🎏 Cá Koi đỏ trắng | 2–5 | 5 s | 3 | Heart Me (giftId 7934) — mapping riêng |
| định kỳ | `big_fish_event` | Cá to xuất hiện! | 🐋 Cá to bí ẩn | 8–30 | 8 s | 10 | — (xem dưới) |
| tập thể | `grand_haul` | Cả hồ kéo Cá Thần | 👑 Cá Thần | 200–400 | 12 s | 0 | — (xem dưới) |

- **Cách chọn hành động cho một lượt quà** (chỉ xét mapping đang bật và có "Số lượng tối thiểu" ≤ số quà):
  1. mapping có **đúng giftId** thắng trước (mặc định chỉ có Heart Me → Kéo cá Koi);
  2. không có thì xét các bậc **giftId 0**, chọn bậc có `minDiamonds` cao nhất mà vẫn ≤ tổng giá trị (hoà thì `minCount` cao hơn thắng);
  3. nền tảng không gửi giá trị (0 kim cương) → lấy bậc thấp nhất. Giá trị thấp hơn mọi bậc thì không kích hoạt gì.
- **Quà luôn được chạy:** cooldown toàn cục và theo người mặc định là 0, quà không bị chặn bởi giới hạn follow, nhưng vẫn xếp hàng đợi (ưu tiên cao hơn). Nút "Thử" trên dashboard cũng chạy được mọi hành động.
- Mọi cấu hình (bật/tắt, cooldown, loài cá + khoảng cân, mapping quà + mốc kim cương, chu kỳ câu, bảng cá thường, số ghế Bến Vàng, mục tiêu tập thể) đều chỉnh được trên dashboard. Giá trị mặc định nằm ở `apps/server/src/config/defaults.ts` và chỉ được ghi vào DB ở lần chạy đầu tiên. Riêng danh sách hành động do code quy định: mỗi lần khởi động, server thêm hành động mới, xoá hành động đã bỏ và chuyển mapping quà của chúng sang hành động dự phòng.

**Cá to định kỳ.** Cứ `fishing.bigFishEveryMs` (mặc định 180000 = 3 phút; 0 = tắt) lại có **"CÁ TO XUẤT HIỆN!"**: server chọn ngẫu nhiên một người đang ngồi câu (người ở Bến Vàng có cơ hội gấp đôi) và chạy hành động `fishing.bigFishActionId` (mặc định `big_fish_event`). Snapshot có `nextBigFishAt` và tin `bigfish.next` để HUD đếm ngược.

**Sự kiện tập thể "Cả hồ kéo Cá Thần".** Mỗi bình luận hoặc hành động góp một phần vào mục tiêu (mặc định 100). Đủ mục tiêu thì chạy `grand_haul`: mọi cần thủ cùng kéo một sợi dây, lôi Cá Thần (200–400 kg) lên bờ; số kg chia đều cho người góp sức. Người tham gia nhận danh hiệu **Kẻ săn Cá Thần**.

**Hai bảng xếp hạng.** **BẢNG CÂN CÁ** (`kgBoard`, xếp theo tổng kg trong phiên) và **TOP QUÀ TẶNG** (`leaderboard`, xếp theo tổng kim cương đã tặng, rồi điểm, rồi số lượt tham gia). Tin WS `leaderboard` mang cả hai (`entries`, `kgBoard`); snapshot cũng vậy. Tổng cân toàn thời gian lưu ở Postgres (gram, số nguyên).

**Cá Thần.** Cá Thần là loài cá to bậc cao nhất (`pull_legend`, `grand_haul`). Kiểu `KingState` (`calm`, `stamina`, `mood`) và `kingEffect` vẫn còn trong dữ liệu và server vẫn tính, nhưng **HUD không hiển thị thanh Cá Thần**.

**Việc vui bằng bình luận (ai cũng làm được, kể cả tập sự).** Ngoài việc vào hồ, người xem gõ từ khoá để cần thủ làm động tác vui tại chỗ: bong bóng emoji và câu nói hiện trên đầu, người đó được cộng điểm. Các việc này không ảnh hưởng việc câu và không vào hàng đợi hoạt ảnh. Mặc định:

| ID | Việc | Từ khoá | Emoji | Câu nói |
|----|------|---------|:-----:|---------|
| `thay_moi` | Thay mồi | `thay moi`, `moc moi`, `moi` | 🪱 | Mồi giun xịn đây! |
| `uong_tra` | Uống trà đá | `tra da`, `uong tra`, `nghi` | 🍵 | Làm cốc trà đá đã... |
| `khoe_ca` | Khoe cá | `khoe`, `song ao`, `check in` | 📸 | Cá to chưa anh em! |
| `hat_ho` | Hát hò | `hat`, `hat ho`, `ca hat` | 🎵 | Ơi à ơi... cá ơi lên đi! |
| `ngu_gat` | Ngủ gật | `ngu`, `buon ngu`, `ngu gat` | 😴 | Zzz... cá cắn câu thì gọi nhé |

Nếu admin bật từ khoá bình luận cho một hành động và bình luận khớp cả việc vui lẫn hành động, từ khoá khớp dài hơn sẽ thắng; dài bằng nhau thì hành động thắng. Tuỳ chọn `followersOnly` của hành động khi đó chỉ cho **cần thủ** (đã follow) dùng bình luận; **tập sự** gõ lệnh sẽ bị chặn kèm gợi ý follow (tối đa 1 lần/người/60 giây). Sửa danh sách việc ở tab **Việc câu** trên dashboard.

**Danh hiệu cần thủ** (`PlayerTitle.id`): `rookie` Cần thủ tập sự (mặc định) · `angler` Cần thủ chăm chỉ · `big_catch` Sát thủ cá to (từng câu được cá ≥ 10 kg) · `troll` Kẻ phá hồ (nhiều lượt quà) · `king_hunter` Kẻ săn Cá Thần (nhận từ sự kiện tập thể).

**Thẻ cần thủ.** Người xem chưa follow kênh mang thẻ **TẬP SỰ**. Người đã follow mang thẻ **CẦN THỦ** và đội nón lá. Trạng thái follow lấy từ dữ liệu TikTok (`userIdentity.isFollowerOfAnchor`, `followInfo.followStatus`) hoặc từ sự kiện follow. Thông tin này chỉ giữ trong bộ nhớ, theo từng phiên.

**Chế độ demo** sinh tên người xem kiểu cần thủ, bình luận theo từ khoá ("thay mồi", "trà đá"…) và quà với giá trị kim cương gần đúng TikTok (Rose 1, Heart Me 1, Finger Heart 5, Perfume 20, Doughnut 30, Hat and Mustache 99, Corgi 299, Money Gun 500…) nên chạy qua đủ mọi bậc cá to.

**Nâng cấp từ bản văn phòng (một lần).** Cấu hình có số phiên bản (`GameConfig.version`, hiện tại `CONFIG_VERSION = 3`; Postgres lưu ở `settings.version`). Khi server khởi động:

- Cấu hình bản 1 (thiếu phiên bản): bỏ trigger bình luận/like/share và từ khoá của các trò cũ, thay mapping quà mặc định cũ bằng các bậc kim cương; mapping quà riêng do admin thêm được giữ.
- Cấu hình bản ≤ 2 (chủ đề "Sếp ơi em xin nghỉ!"): id hành động cũ đổi sang id mới theo thứ tự bậc (`throw_paper`→`pull_carp`, `pluck_tree`→`pull_grass_carp`, `doodle_kpi`→`pull_catfish`, `complaint_call`→`pull_snakehead`, `crash_pc`→`pull_giant_catfish`, `lock_toilet`→`pull_arowana`, `flat_tire`→`pull_stingray`, `blackout`→`pull_legend`, `praise_boss`→`pull_koi`, `strike`→`grand_haul`); `actionId` trong mapping quà và sự kiện tập thể đổi theo; danh sách công việc văn phòng thay bằng việc vui mặc định; tên, mô tả, danh hiệu sự kiện tập thể đổi sang mặc định mới. Khoá settings `boss` cũ được đọc làm `king` nếu chưa có `king`.
- CSDL thêm migration `0001_fishing.sql` (cột `players.total_grams`, `session_players.grams`), chạy tự động khi khởi động. Cột `actions.boss_effect` giữ tên cũ trong SQL.
- Sau khi nâng cấp, chỉnh sửa của admin được giữ nguyên ở các lần khởi động sau.

## Yêu cầu

- **Bun ≥ 1.4**. Cài bằng `npm i -g bun`.
- **PostgreSQL 16** (tuỳ chọn). Đặt `STORE=memory` thì chạy được không cần DB, nhưng dữ liệu mất khi tắt server.

## Chạy local (không cần Docker)

```bash
bun install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
# sửa .env: đổi ADMIN_PASSWORD, SESSION_SECRET (>= 32 ký tự), OVERLAY_KEY
bun run local             # build overlay + admin rồi chạy server
```

- Bun tự đọc tệp `.env` ở thư mục gốc, không cần thêm công cụ nào.
- `.env.example` để sẵn `STORE=memory`. Muốn dùng Postgres: đặt `STORE=postgres` và `DATABASE_URL=postgres://...`. Migration chạy tự động khi server khởi động; muốn chạy tay thì dùng `bun run db:migrate`.
- Khi đã build rồi, chỉ cần `bun run start`.
- Mặc định server nghe ở `http://127.0.0.1:3000` (đổi bằng `HOST`, `PORT`).

**Chế độ dev (hot reload).** Chạy mỗi lệnh trong một terminal riêng:

| Lệnh | Địa chỉ | Ghi chú |
|------|---------|---------|
| `bun run dev:server` | :3000 | `bun --watch`; giữ `PORT=3000` để proxy hoạt động |
| `bun run dev:overlay` | http://localhost:5173/overlay/ | Vite proxy `/api`, `/ws` → `127.0.0.1:3000` |
| `bun run dev:admin` | http://localhost:5174/admin/ | Vite proxy `/api`, `/ws` → `127.0.0.1:3000` |

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `ADMIN_PASSWORD` | (bắt buộc, ≥ 8) | Mật khẩu dashboard |
| `SESSION_SECRET` | (bắt buộc, ≥ 32) | Khoá HMAC ký cookie phiên |
| `OVERLAY_KEY` | (bắt buộc, ≥ 8) | Khoá trong URL overlay |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Địa chỉ server |
| `STORE` | `postgres` (`.env.example` để `memory`) | `postgres` hoặc `memory` |
| `DATABASE_URL` | (không có) | Bắt buộc khi `STORE=postgres` |
| `COOKIE_SECURE` | `false` | Đặt `true` khi chạy sau HTTPS |
| `TIKTOK_USERNAME` | (trống) | Có giá trị thì tự kết nối khi khởi động |
| `TIKTOK_SIGN_API_KEY` | (trống) | API key của sign server (Euler Stream), nếu cần |
| `HISTORY_RETENTION_DAYS` | `30` | Số ngày giữ lịch sử sự kiện (1–3650) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `STATIC_DIR` | (không có) | Thư mục build tĩnh; mặc định dùng `apps/*/dist` |
| `NODE_ENV` | `development` | `development`, `production`, `test` (image Docker đặt `production`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `sep` / (bắt buộc) / `sep` | Chỉ Docker dùng (tài khoản Postgres) |
| `PUBLIC_BIND` / `PUBLIC_PORT` | `127.0.0.1` / `8080` | Chỉ Docker dùng (cổng Nginx) |

Tên user/DB Postgres mặc định `sep` là di sản từ chủ đề văn phòng cũ. Giữ nguyên để không mất dữ liệu đã có; cài mới thì đổi tuỳ ý trong `.env`.

## Địa chỉ

| URL | Dùng để |
|-----|---------|
| `/admin/` | Dashboard, đăng nhập bằng `ADMIN_PASSWORD` (`/` tự chuyển về đây) |
| `/overlay/?key=<OVERLAY_KEY>` | Overlay cho OBS |
| `/healthz` | Kiểm tra sống (200 khi ổn, 503 khi lỗi) |

**Xem trước overlay không cần server.** Mở overlay với tham số `preview`, ví dụ chạy `bun run dev:overlay` rồi vào:

- `/overlay/?preview=all&people=100`: lần lượt mọi hoạt ảnh, 100 cần thủ giả (mặc định `people=24`).
- `/overlay/?preview=pull_legend`: chỉ một hoạt ảnh (dùng ID của hành động, ví dụ `pull_carp`, `pull_stingray`, `big_fish_event`, `grand_haul`).
- `&fps=60`: đổi giới hạn FPS (mặc định 30). Tham số này dùng được cả khi chạy thật.

## OBS

1. Thêm **Browser Source**, đặt URL `http://127.0.0.1:3000/overlay/?key=<OVERLAY_KEY>` (với Docker là `http://127.0.0.1:8080/...`).
2. Width **1080**, Height **1920**, FPS 30.
3. **Tắt** "Shutdown source when not visible" để overlay không mất kết nối WebSocket khi đổi scene.
4. Overlay tự kết nối lại khi server khởi động lại. Không cần bật "Refresh browser when scene becomes active".

## Kết nối TikTok LIVE

- Vào dashboard, nhập username TikTok rồi bấm kết nối. Hoặc đặt `TIKTOK_USERNAME` để server tự kết nối khi khởi động.
- `TIKTOK_SIGN_API_KEY` là tuỳ chọn, chỉ cần khi sign server yêu cầu.
- Mọi thông tin TikTok chỉ nằm ở server. Overlay và dashboard không bao giờ nhận được chúng.
- **Chế độ Demo** (bật trong dashboard) tạo người xem giả để thử. Sự kiện demo được gắn nhãn **DEMO** rõ ràng, và người chơi demo không được lưu vào DB.

## Docker (tuỳ chọn)

```bash
cp .env.example .env      # đặt thêm POSTGRES_PASSWORD
docker compose up -d --build
```

- Gồm 3 service: `postgres` (16-alpine, volume `pgdata`), `server` (chỉ mở cổng 3000 trong mạng nội bộ, không ra ngoài) và `nginx`.
- Nginx gắn vào `PUBLIC_BIND:PUBLIC_PORT`, mặc định `127.0.0.1:8080`. Đặt `0.0.0.0` để mở ra mạng LAN. Muốn bật HTTPS thì sửa `docker/nginx.conf` và đặt `COOKIE_SECURE=true`.
- Image server bundle toàn bộ server thành **một tệp JS** (`bun build --minify`). Lúc chạy chỉ còn Bun, `index.js`, migrations và file tĩnh, không có `node_modules`.
- Compose tự đặt `STORE=postgres` và `DATABASE_URL`, nên các giá trị `HOST`, `PORT`, `STORE` trong `.env` không ảnh hưởng tới Docker.
- Tên project compose (`sep-oi-em-xin-nghi`) được giữ từ bản văn phòng: Docker đặt tên volume theo tên project, đổi tên sẽ tạo volume `pgdata` mới (trống) và "mất" dữ liệu cũ. Cài mới hoàn toàn thì có thể đổi `name:` trong `docker-compose.yml`.

## Hiệu năng (chạy nhẹ)

- Toàn bộ hình ảnh là pixel art **vẽ bằng code** (PixiJS `Graphics`, phong cách 16-bit, viền đậm, màu hoàng hôn ấm). Overlay **không tải ảnh sprite** nào.
- `antialias: false`, `resolution: 1`, giới hạn 30 FPS.
- Các lớp tĩnh (trời, bờ xa, mặt hồ, bờ, bảng thống kê) được gộp sẵn thành texture (`cacheAsTexture`).
- Chỗ ngồi, cần câu và cần thủ dùng chung `GraphicsContext`.
- Cá câu tự động gửi gộp **một** tin `catches` mỗi chu kỳ thay vì một tin mỗi con.
- Danh sách cần thủ giới hạn 100 người (`ROSTER_MAX`).
- Bảng xếp hạng, feed và roster được gom lại, gửi tối đa một lần mỗi chu kỳ thay vì gửi theo từng sự kiện.

## Hình ảnh

Overlay hiện vẽ mọi thứ bằng code (hồ, cần thủ, cá, Cá Thần, hiệu ứng kéo cá…), không có sheet ảnh hay script cắt sprite. Hợp đồng giữa phần dựng cảnh và phần hoạt ảnh nằm ở `apps/overlay/src/scene/contract.ts`.

Nếu sau này muốn thay bằng pixel art vẽ sẵn, prompt gợi ý cho ảnh nền hồ, Cá Thần, cần thủ và cảnh dưới nước nằm ở `docs/image-prompts.md` (cần viết thêm code nạp ảnh; hiện overlay chưa tải ảnh nào).

## Kiểm thử

```bash
bun test             # test trong apps/server/test (engine, http, roster, tiktok, work, ...)
bun run typecheck    # tsc cho shared, server, overlay, admin
```

## Tuân thủ chính sách TikTok LIVE

Tóm tắt cập nhật ngày 04/11/2026. Trang chính thức [LIVE Monetization Guidelines](https://www.tiktok.com/live/creators/en-US/rules_and_guidance/live_monetization_guidelines) cần đăng nhập mới đọc được, nên các điểm dưới đây có phần lấy từ hướng dẫn của bên thứ ba. Trước buổi LIVE lớn nên đọc lại bản gốc.

**Rủi ro chính và cách trò chơi đã xử lý:**

| Rủi ro (theo TikTok) | Trong game |
|---|---|
| **Trò may rủi / cá cược** gắn với quà ("tặng quà để quay", rút thăm, xổ số) bị cấm | Quà cho **loài cá cố định theo bậc kim cương** và **cân cố định** (giữa khoảng, `fixedBigFish`). Không có tỉ lệ trúng khi người xem bỏ tiền. Yếu tố ngẫu nhiên chỉ có ở phần miễn phí: câu thường từ bình luận, cá to định kỳ (chọn đều trong người đang ngồi), cá chia cho cả hồ. |
| **Giải thưởng giá trị thật** cho quà | Không có. Overlay luôn ghi "Điểm chỉ để vui, không quy đổi". |
| **Gift baiting**: xin quà lặp lại, máy móc, gây áp lực, lừa người xem | Chữ trên màn hình trung tính, chỉ mô tả luật chơi ("Mỗi quà = một loài cá cố định"). Không có lời nhắc tặng quà tự động; lời nhắc follow cũng không nhắc tới quà. |
| **LIVE thụ động / không người trông / tự động hoá** (treo máy, chỉ chạy công cụ bên thứ ba, màn hình tĩnh hoặc lặp lại) | Game chỉ là phần phụ trợ. **Chủ phòng phải có mặt** (cam/mic, đọc bình luận, dẫn chuyện). Rời máy thì bấm **Pause LIVE** trên TikTok và **Dừng game** ở dashboard (overlay hiện "Hồ câu đang tạm dừng"). |
| **Dữ liệu giả** trộn với người xem thật | Demo bị khoá khi đang kết nối TikTok thật, và luôn có dải DEMO nằm dưới thanh TikTok. |
| Tên / bình luận phản cảm hiện lên màn hình | Mọi tên và bình luận hiển thị đều đi qua bộ lọc từ. Admin có thể mời người rời hồ. |
| **Nhạc có bản quyền** | Overlay không phát nhạc. Nhạc nền chỉ lấy từ thư viện nhạc LIVE của TikTok hoặc nguồn có giấy phép. |
| **Tuổi** | Phải đủ 18 tuổi mới LIVE nhận quà. Không để trẻ vị thành niên lên hình một mình. |

**Khi vận hành:**

- Không treo LIVE nhiều giờ chỉ có hồ câu tự chạy. Xen kẽ trò chuyện, đọc tên người lên cá, thỉnh thoảng đổi nội dung.
- Không ghi cách tặng quà vào tiêu đề hay mô tả LIVE. Không đưa mã QR hay tên nền tảng khác lên màn hình.
- Không hứa thưởng ngoài game (tiền, quà thật, "top quà được …") để đổi lấy quà.
- Bị hạn chế thì vào **Account Status** xem chính sách bị nêu, và kháng nghị ngay (thường không kháng nghị được sau khi LIVE kết thúc). Vi phạm lặp lại trong 90 ngày sẽ bị phạt nặng hơn.

## Bảo mật

- Dashboard dùng cookie phiên ký HMAC (`SESSION_SECRET`), có cờ `httpOnly` và `SameSite=Strict`. Đăng nhập bị giới hạn 5 lần mỗi phút cho mỗi IP. Mọi API ghi dữ liệu bắt buộc gửi JSON để chống CSRF.
- Overlay chỉ đọc qua WebSocket và cần đúng `OVERLAY_KEY`. Header `Referrer-Policy: no-referrer` và log Nginx không ghi query string, nên key không bị lộ.
- Không lưu username, key hay thông tin TikTok ở frontend.
- Điểm, cá và danh hiệu trong game chỉ để vui, **không quy đổi ra giá trị thật**.

## Cấu trúc thư mục

```
packages/shared/    kiểu dữ liệu + zod schema dùng chung (gói @cau/shared — hợp đồng server ↔ overlay ↔ admin)
apps/server/        Bun + Hono + WebSocket: engine, câu tự động + cá to, connector TikTok/Demo, store (Postgres/Drizzle hoặc memory)
  src/db/migrations/  migration SQL (Drizzle)
apps/overlay/       PixiJS overlay 1080×1920 cho OBS (hình vẽ bằng code)
  src/scene/          dựng cảnh hồ, cần thủ, cá, hoạt ảnh (contract.ts = hợp đồng)
apps/admin/         dashboard React + Vite
docs/               thiết kế trò chơi, prompt ảnh tham khảo
docker/             Dockerfile server + cấu hình Nginx
docker-compose.yml  postgres + server + nginx
legacy/             bản cũ, không dùng
```
