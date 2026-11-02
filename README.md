# SẾP ƠI EM XIN NGHỈ!

Trò chơi văn phòng tương tác cho **TikTok LIVE**: người xem **tặng quà** để "quậy" Sếp (quà càng to, trò càng nặng) và **bình luận** để làm việc, góp sức đình công. Hình ảnh chạy trên overlay dọc 1080×1920 (gắn vào OBS); chủ phòng điều khiển qua dashboard.

## Tính năng

**9 hành động "trêu Sếp" — chỉ kích hoạt bằng quà tặng.** Bình luận, thả tim, chia sẻ không còn kích hoạt trò trêu Sếp (mặc định `trigger.kinds = []`, không có từ khoá). Quà được ánh xạ sang hành động theo **giá trị**: tổng giá trị = kim cương của một món × số lượng (sau khi gộp combo). Hành động chạy **lần lượt từng cái một**: cái trước diễn xong thì cái sau (đang chờ trong hàng đợi) mới bắt đầu.

| Từ (kim cương) | ID | Hành động | Ví dụ quà |
|---:|----|-----------|-----------|
| 1 | `throw_paper` | Ném giấy vào Sếp | Rose, TikTok, GG |
| 5 | `pluck_tree` | Vặt lá cây phát tài | Finger Heart, Rose ×5 |
| 10 | `doodle_kpi` | Vẽ bậy lên bảng KPI | Rose ×10, Perfume (20) |
| 30 | `complaint_call` | Khách gọi phàn nàn | Doughnut |
| 99 | `crash_pc` | Làm treo máy tính Sếp | Hat and Mustache |
| 199 | `lock_toilet` | Khóa nhà vệ sinh | Hat and Mustache ×2–3 |
| 299 | `flat_tire` | Xịt lốp xe Sếp (cảnh cắt ra bãi đỗ xe) | Corgi |
| 499 | `blackout` | Ngắt cầu dao: cả văn phòng mất điện | Money Gun (500) |
| — | `praise_boss` | Nịnh Sếp: Sếp bình tĩnh lại một chút | Heart Me (giftId 7934) — mapping riêng |

- **Cách chọn hành động cho một lượt quà** (chỉ xét mapping đang bật và có "Số lượng tối thiểu" ≤ số quà):
  1. mapping có **đúng giftId** thắng trước (mặc định chỉ có Heart Me → Nịnh Sếp: quà "tình cảm" thì nịnh, không phá);
  2. không có thì xét các bậc **giftId 0**, chọn bậc có `minDiamonds` cao nhất mà vẫn ≤ tổng giá trị (hoà thì `minCount` cao hơn thắng);
  3. nền tảng không gửi giá trị (0 kim cương) → lấy bậc thấp nhất. Giá trị thấp hơn mọi bậc thì không kích hoạt gì.
- **Mỗi người tự ra tay.** Nhân vật của chính người tặng quà đứng dậy khỏi ghế, đi tới chỗ cần phá (cây phát tài, bảng KPI, cầu dao, WC, bàn Sếp, bãi đỗ xe) rồi mới diễn. Ghế để trống cho tới khi người đó quay về.
- **Quà luôn được chạy:** không bị chặn bởi cooldown hay giới hạn follow, nhưng vẫn xếp hàng đợi (ưu tiên cao hơn). Nút "Thử" trên dashboard cũng chạy được mọi hành động.
- **Bảng xếp hạng "phá Sếp".** Xếp theo **tổng kim cương đã tặng** (giảm dần), rồi điểm, rồi số lượt tham gia. Mỗi mục `LeaderboardEntry` có trường `diamonds` (trong phiên ở bảng phiên, toàn thời gian ở bảng tổng); tin nhắn WS `leaderboard` và snapshot đều mang trường này.
- **Muốn bật lại trêu Sếp bằng bình luận** cho một hành động: điền từ khoá ở tab Hành động (dashboard tự bật trigger bình luận). Tuỳ chọn `followersOnly` (mặc định bật cho các trò phá) khi đó chỉ cho nhân viên chính thức (đã follow) dùng bình luận; thực tập sinh gõ lệnh sẽ bị chặn kèm gợi ý follow (tối đa 1 lần/người/60 giây).
- **Sự kiện tập thể "Đình công toàn công ty":** mỗi bình luận hoặc hành động góp một phần vào mục tiêu (mặc định 100). Đủ mục tiêu thì cả văn phòng cùng đình công.
- Mọi cấu hình (bật/tắt, cooldown, từ khoá, mapping quà + mốc kim cương, mục tiêu tập thể) đều chỉnh được trên dashboard. Giá trị mặc định nằm ở `apps/server/src/config/defaults.ts` và chỉ được ghi vào DB ở lần chạy đầu tiên. Riêng danh sách hành động do code quy định: mỗi lần khởi động, server thêm hành động mới, xoá hành động đã bỏ và chuyển mapping quà của chúng sang "Vặt lá cây phát tài".
- **Nâng cấp cấu hình cũ (một lần).** Cấu hình có số phiên bản (`GameConfig.version`, hiện tại `CONFIG_VERSION = 2`; Postgres lưu ở `settings.version`). Cấu hình đã lưu từ bản cũ (thiếu phiên bản = 1) được nâng cấp khi server khởi động: bỏ trigger bình luận/like/share và từ khoá của các trò trêu Sếp, thay mapping quà mặc định cũ (Rose, Rose ×10, mọi dòng giftId 0) bằng các bậc kim cương ở trên; mapping quà riêng do admin thêm được giữ. Sau khi nâng cấp, chỉnh sửa của admin được giữ nguyên ở các lần khởi động sau.

**Công việc (ai cũng làm được, kể cả TTS).** Người xem gõ từ khoá để nhân vật làm việc tại chỗ: bong bóng emoji và câu nói hiện trên đầu, nhân vật gõ phím lia lịa, người đó được cộng điểm. Công việc không ảnh hưởng Sếp và không vào hàng đợi hoạt ảnh. Mặc định có 6 việc:

| ID | Công việc | Từ khoá | Điểm |
|----|-----------|---------|------|
| `lam_viec` | Làm việc | `lam viec`, `go phim`, `chay deadline` | 2 |
| `nop_bao_cao` | Nộp báo cáo | `nop bao cao`, `bao cao` | 3 |
| `tang_ca` | Tăng ca | `tang ca`, `ot` | 3 |
| `pha_ca_phe` | Pha cà phê | `pha ca phe`, `uong cafe` | 1 |
| `xin_nghi` | Xin nghỉ | `xin nghi`, `nghi phep` | 1 |
| `hop_nhom` | Họp nhóm | `hop nhom`, `meeting` | 2 |

Với cấu hình mặc định, bình luận chỉ dùng cho công việc (và góp sức Đình công). Nếu admin bật lại từ khoá bình luận cho một hành động và bình luận khớp cả công việc lẫn hành động, từ khoá khớp dài hơn sẽ thắng; dài bằng nhau thì hành động thắng. Sửa danh sách công việc ở tab **Công việc** trên dashboard.

**Chế độ demo** sinh quà với giá trị kim cương gần đúng TikTok (Rose 1, Heart Me 1, Finger Heart 5, Perfume 20, Doughnut 30, Hat and Mustache 99, Corgi 299, Money Gun 500…) nên chạy qua đủ mọi bậc trêu Sếp.

**Văn phòng kiểu lớp học.** Sếp đứng trên bục, bên dưới là 4 phòng ban: Kế toán, Nhân sự, Kinh doanh, IT. Số ghế tự giãn theo số người tham gia (32 → 48 → 72 → 112), hiển thị tối đa 100 nhân viên.

**Thẻ nhân viên.** Người xem chưa follow kênh mang thẻ **TTS** (thực tập sinh). Người đã follow mang thẻ **CHÍNH THỨC** và đeo cà vạt. Trạng thái follow lấy từ dữ liệu TikTok (`userIdentity.isFollowerOfAnchor`, `followInfo.followStatus`) hoặc từ sự kiện follow. Thông tin này chỉ giữ trong bộ nhớ, theo từng phiên.

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
| `HISTORY_RETENTION_DAYS` | `30` | Số ngày giữ lịch sử sự kiện |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `STATIC_DIR` | (không có) | Thư mục build tĩnh; mặc định dùng `apps/*/dist` |
| `PUBLIC_BIND` / `PUBLIC_PORT` | `127.0.0.1` / `8080` | Chỉ Docker dùng (cổng Nginx) |

## Địa chỉ

| URL | Dùng để |
|-----|---------|
| `/admin/` | Dashboard, đăng nhập bằng `ADMIN_PASSWORD` (`/` tự chuyển về đây) |
| `/overlay/?key=<OVERLAY_KEY>` | Overlay cho OBS |
| `/healthz` | Kiểm tra sống (200 khi ổn, 503 khi lỗi) |

**Xem trước overlay không cần server.** Mở overlay với tham số `preview`, ví dụ chạy `bun run dev:overlay` rồi vào:

- `/overlay/?preview=all&people=100`: lần lượt mọi hoạt ảnh, 100 nhân viên giả (mặc định `people=24`).
- `/overlay/?preview=flat_tire`: chỉ một hoạt ảnh (dùng ID của hành động).
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

## Hiệu năng (chạy nhẹ)

- Dùng pixel art, `antialias: false`, `resolution: 1`, giới hạn 30 FPS.
- Các lớp tĩnh (nền, bục Sếp, bảng thống kê) được gộp sẵn thành texture (`cacheAsTexture`).
- Mọi bàn và ghế dùng chung một `GraphicsContext`.
- Cảnh bãi đỗ xe chỉ được vẽ khi đang hiện.
- Danh sách nhân viên giới hạn 100 người (`ROSTER_MAX`).
- Bảng xếp hạng, feed và roster được gom lại, gửi tối đa một lần mỗi chu kỳ thay vì gửi theo từng sự kiện.

## Ảnh nhân vật, ngoại cảnh, đồ vật

| Nguồn | Nội dung | Lệnh tạo lại | Đầu ra |
|-------|----------|--------------|--------|
| `assets-src/boss-sheet.png` | 20 tư thế tĩnh (lưới 4 hàng × 5 cột, ảnh 2816×1536) | `bun scripts/extract-boss-sprites.ts` | `apps/overlay/public/sprites/boss/<id>.png` |
| `assets-src/boss-frames.png` | 8 hoạt ảnh × 8 khung: idle, walk, run, rage, scold, paper, desk, phone | `bun scripts/extract-boss-frames.ts` | `apps/overlay/public/sprites/boss-anim/<tên>.png` + `manifest.json` |
| `assets-src/staff-sheet.png` | 10 nhân viên × 11 khung: đứng, 3 bước đi, giận, hét, hoảng, cổ vũ, điện thoại, máy tính bảng, ngồi bàn | `bun run sprites:staff` | `apps/overlay/public/sprites/staff/c<n>.png` + `manifest.json` |
| `assets-src/parking.png` | Ngoại cảnh bãi đỗ xe (cảnh "Xịt lốp") | `bun scripts/prepare-parking-bg.ts` | `apps/overlay/public/sprites/bg/parking.png` |
| `assets-src/props-sheet.png` | Đồ vật: xe hơi của Sếp, xe cứu thương, xe máy, chậu cây | `bun scripts/extract-props.ts` | `apps/overlay/public/sprites/props/<id>.png` |
| `assets-src/tree-sheet.png` | Cây phát tài 5 mức trụi lá + cụm lá / đống lá rụng | `bun scripts/extract-tree.ts` | `apps/overlay/public/sprites/props/tree.png`, `leaf-*.png` |
| `assets-src/office-wall.png` | Tường + bục Sếp (ngang 16:9) | `bun scripts/prepare-office-wall.ts` | `apps/overlay/public/sprites/bg/office-wall.png` |
| `assets-src/office-props.png` | Bàn Sếp, bàn nhân viên, cửa WC (thường / bị khoá), cầu dao (bật / tắt) — nền hồng #FF00FF | `bun scripts/extract-office-props.ts` | `apps/overlay/public/sprites/props/<id>.png` |

Prompt dùng để tạo các ảnh bối cảnh: `docs/image-prompts.md`. Thiếu ảnh nào thì overlay tự dùng hình vẽ tay thay thế.

**Thay ảnh.** Vẽ sheet mới theo **đúng bố cục lưới và thứ tự ô** của sheet cũ, ghi đè tệp trong `assets-src/`, chạy lại script rồi build lại overlay. Nếu kích thước hoặc vị trí ô khác đi, sửa các mảng `ROWS`, `COLS` (hoặc `COL_EDGES`) ở đầu script. Có thể truyền đường dẫn sheet khác làm tham số đầu tiên. Script tự xoá nền ca-rô (kiểu "trong suốt giả") và cắt sát nhân vật.

## Kiểm thử

```bash
bun test             # test trong apps/server/test (engine, http, roster, tiktok, ...)
bun run typecheck    # tsc cho shared, server, overlay, admin
```

## Bảo mật

- Dashboard dùng cookie phiên ký HMAC (`SESSION_SECRET`), có cờ `httpOnly` và `SameSite=Strict`. Đăng nhập bị giới hạn 5 lần mỗi phút cho mỗi IP. Mọi API ghi dữ liệu bắt buộc gửi JSON để chống CSRF.
- Overlay chỉ đọc qua WebSocket và cần đúng `OVERLAY_KEY`. Header `Referrer-Policy: no-referrer` và log Nginx không ghi query string, nên key không bị lộ.
- Không lưu username, key hay thông tin TikTok ở frontend.
- Điểm trong game chỉ để vui, **không quy đổi ra giá trị thật**.

## Cấu trúc thư mục

```
packages/shared/    kiểu dữ liệu + zod schema dùng chung
apps/server/        Bun + Hono + WebSocket: engine, connector TikTok/Demo, store (Postgres/Drizzle hoặc memory)
  src/db/migrations/  migration SQL (Drizzle)
apps/overlay/       PixiJS overlay 1080×1920 cho OBS
apps/admin/         dashboard React + Vite
assets-src/         sheet ảnh gốc của Sếp
scripts/            script cắt sprite
docker/             Dockerfile server + cấu hình Nginx
docker-compose.yml  postgres + server + nginx
```
