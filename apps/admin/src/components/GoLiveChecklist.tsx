import { memo, useState } from 'react';
import type { GameSnapshot } from '@cau/shared';
import { PRESENCE_OPTIONS, usePresence } from '../presence';

/** Danh sách kiểm tra trước khi lên LIVE — theo mục "Tuân thủ chính sách TikTok LIVE" (docs/fishing-design.md). */
const ITEMS: { id: string; text: string; hint?: string }[] = [
  { id: 'demo', text: 'Tắt chế độ DEMO', hint: 'Demo chỉ bật được khi TikTok đã ngắt hẳn; sự kiện demo luôn có nhãn DEMO to.' },
  { id: 'connect', text: 'Kết nối đúng kênh TikTok LIVE, trạng thái "Đã kết nối"' },
  { id: 'reset', text: 'Buổi LIVE mới: "Reset phiên LIVE" (thẻ Vùng nguy hiểm cuối trang) để bảng cân cá / top quà về 0' },
  { id: 'verified', text: 'Tài khoản đã xác thực danh tính theo Nghị định 147/2024/NĐ-CP', hint: 'Tài khoản chưa định danh không được phát LIVE.' },
  { id: 'age', text: 'Chủ phòng từ 18 tuổi trở lên', hint: 'Yêu cầu của TikTok cho LIVE có nhận quà.' },
  {
    id: 'host',
    text: 'Chủ phòng có mặt suốt buổi: cam / mic, dẫn trực tiếp, trò chuyện với người xem',
    hint: 'Trò chơi chỉ là phần phụ — TikTok cấm LIVE treo máy / tự động. Không dùng giọng AI / đọc chữ tự động thay chủ phòng.'
  },
  { id: 'pause', text: 'Tôi sẽ dùng "Tạm dừng LIVE" của TikTok hoặc kết thúc LIVE khi rời máy' },
  { id: 'heartbeat', text: 'Bật nhắc "chủ phòng có mặt" trên bảng điều khiển' },
  {
    id: 'tiers',
    text: 'Quà → loài cá và cân CỐ ĐỊNH theo bậc kim cương, không có tỉ lệ trúng',
    hint: 'Cân cá khi có quà = giữa khoảng kg (không may rủi). Cá to định kỳ chọn đều trong số người đang ngồi, không ưu tiên người tặng quà.'
  },
  { id: 'prize', text: 'Không hứa giải thưởng giá trị thật', hint: 'Overlay luôn ghi "Điểm chỉ để vui, không quy đổi".' },
  { id: 'wording', text: 'Câu chữ trung tính: không xin quà lặp lại, không nhấp nháy / thúc giục tặng quà' },
  { id: 'music', text: 'Nhạc nền có bản quyền / được phép dùng (thư viện nhạc TikTok hoặc nhạc miễn phí bản quyền)' },
  { id: 'links', text: 'Không để link / mã QR / tên nền tảng khác trên màn hình LIVE' },
  { id: 'filter', text: 'Bộ lọc từ đã cập nhật', hint: 'Tên và bình luận hiển thị đều đi qua bộ lọc (tab "Bộ lọc từ").' },
  { id: 'obs', text: 'OBS đã thêm overlay (Browser Source 1080×1920) và URL không lộ lên màn hình' }
];

/** Khoá localStorage: mỗi phiên LIVE một danh sách tick riêng (reset phiên → danh sách trống). */
const STORAGE_PREFIX = 'cau-admin.checklist.';
const storageKey = (sessionId: string | null) => STORAGE_PREFIX + (sessionId ?? 'chua-co-phien');

function loadDone(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDone(key: string, done: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...done]));
    // Dọn danh sách của các phiên cũ để localStorage không phình ra.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX) && k !== key) localStorage.removeItem(k);
    }
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư…) → chỉ giữ trong bộ nhớ.
  }
}

export const GoLiveChecklist = memo(function GoLiveChecklist({ snap }: { snap: GameSnapshot }) {
  const key = storageKey(snap.sessionId);
  const [stored, setStored] = useState(() => ({ key, done: loadDone(key) }));
  // Đổi phiên → nạp danh sách của phiên mới (cập nhật state ngay trong lúc render, theo khuyến nghị của React).
  if (stored.key !== key) setStored({ key, done: loadDone(key) });
  const done = stored.done;
  const demo = snap.connectors.demo.running;
  const tiktok = snap.connectors.tiktok.status;
  const presence = usePresence();
  const toggle = (id: string) => {
    const n = new Set(done);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    saveDone(key, n);
    setStored({ key, done: n });
  };
  // Các mục tự kiểm tra được theo trạng thái thật.
  const auto: Record<string, boolean | undefined> = {
    demo: !demo,
    connect: tiktok === 'connected',
    heartbeat: presence.intervalMin > 0
  };
  const isChecked = (id: string) => auto[id] ?? done.has(id);
  const doneCount = ITEMS.filter((it) => isChecked(it.id)).length;
  const allDone = doneCount === ITEMS.length;
  const [open, setOpen] = useState(!allDone);

  return (
    <section className={allDone ? 'card checklist-card all-done' : 'card checklist-card'}>
      <div className="card-head">
        <h2>✅ Trước khi lên LIVE</h2>
        <span className={allDone ? 'pill green' : 'pill yellow'}>
          {doneCount}/{ITEMS.length}
        </span>
        <button className="ghost small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Thu gọn' : 'Mở danh sách'}
        </button>
      </div>
      <div className="meter" aria-hidden>
        <span style={{ width: `${(doneCount / ITEMS.length) * 100}%` }} />
      </div>
      {demo && (
        <div className="alert danger">
          <b>Chế độ DEMO đang BẬT.</b> Tắt demo trước khi lên LIVE thật — không trộn sự kiện giả với người xem thật.
        </div>
      )}
      {!demo && tiktok !== 'connected' && <div className="alert">Chưa kết nối TikTok LIVE.</div>}
      {!snap.running && <div className="alert">Game đang dừng — bấm "Bắt đầu game" trên thanh điều khiển khi sẵn sàng.</div>}
      {open && (
        <>
          <ul className="checklist">
            {ITEMS.map((it) => {
              const a = auto[it.id];
              const checked = isChecked(it.id);
              return (
                <li key={it.id} className={checked ? 'ok' : ''}>
                  <label className="inline">
                    <input type="checkbox" checked={checked} disabled={a !== undefined} onChange={() => toggle(it.id)} />
                    <span>
                      {it.text}
                      {a !== undefined && <span className="muted"> (tự kiểm tra)</span>}
                      {it.hint && <span className="muted hint">{it.hint}</span>}
                      {it.id === 'heartbeat' && (
                        <span className="hint">
                          <select
                            aria-label="Khoảng nhắc chủ phòng có mặt"
                            className="small"
                            value={presence.intervalMin}
                            onChange={(e) => presence.setIntervalMin(Number(e.target.value))}
                          >
                            {PRESENCE_OPTIONS.map((m) => (
                              <option key={m} value={m}>
                                {m === 0 ? 'Tắt nhắc' : `Nhắc sau ${m} phút không thao tác`}
                              </option>
                            ))}
                          </select>{' '}
                          <span className="muted">quá thêm 3 phút không xác nhận → game tự dừng.</span>
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="muted">Mục tick tay được lưu trên trình duyệt này theo phiên LIVE (tải lại trang không mất).</p>
        </>
      )}
    </section>
  );
});
