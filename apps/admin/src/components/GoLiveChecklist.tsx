import { useState } from 'react';
import type { GameSnapshot } from '@cau/shared';

/** Danh sách kiểm tra trước khi lên LIVE — theo mục "Tuân thủ chính sách TikTok LIVE" (docs/fishing-design.md). */
const ITEMS: { id: string; text: string; hint?: string }[] = [
  { id: 'demo', text: 'Tắt chế độ DEMO', hint: 'Demo bị khoá khi đã kết nối TikTok thật; sự kiện demo luôn có nhãn DEMO to.' },
  { id: 'connect', text: 'Kết nối đúng kênh TikTok LIVE, trạng thái "Đã kết nối"' },
  { id: 'reset', text: 'Buổi LIVE mới: bấm "Reset phiên LIVE" để bảng cân cá / top quà về 0' },
  {
    id: 'tiers',
    text: 'Quà → loài cá CỐ ĐỊNH theo bậc kim cương, không có tỉ lệ trúng',
    hint: 'Cá to định kỳ chọn đều trong số người đang ngồi, không ưu tiên người tặng quà.'
  },
  { id: 'prize', text: 'Không hứa giải thưởng giá trị thật', hint: 'Overlay luôn ghi "Điểm chỉ để vui, không quy đổi".' },
  { id: 'wording', text: 'Câu chữ trung tính: không xin quà lặp lại, không nhấp nháy / thúc giục' },
  { id: 'filter', text: 'Bộ lọc từ đã cập nhật', hint: 'Tên và bình luận hiển thị đều đi qua bộ lọc (tab "Bộ lọc từ").' },
  { id: 'host', text: 'Chủ phòng có mặt (cam / mic, dẫn trực tiếp), không treo máy nhiều giờ' },
  { id: 'obs', text: 'OBS đã thêm overlay (Browser Source 1080×1920) và URL không lộ lên màn hình' }
];

export function GoLiveChecklist({ snap }: { snap: GameSnapshot }) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const demo = snap.connectors.demo.running;
  const tiktok = snap.connectors.tiktok.status;
  const toggle = (id: string) =>
    setDone((d) => {
      const n = new Set(d);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Hai mục tự kiểm tra được theo trạng thái thật.
  const auto: Record<string, boolean | undefined> = { demo: !demo, connect: tiktok === 'connected' };

  return (
    <section className="card checklist-card">
      <h2>✅ Trước khi lên LIVE</h2>
      {demo && (
        <div className="alert danger">
          <b>Chế độ DEMO đang BẬT.</b> Tắt demo trước khi lên LIVE thật — không trộn sự kiện giả với người xem thật.
        </div>
      )}
      {!demo && tiktok !== 'connected' && <div className="alert">Chưa kết nối TikTok LIVE.</div>}
      {!snap.running && <div className="alert">Game đang dừng — bấm "Bắt đầu game" khi sẵn sàng.</div>}
      <ul className="checklist">
        {ITEMS.map((it) => {
          const a = auto[it.id];
          const checked = a ?? done.has(it.id);
          return (
            <li key={it.id} className={checked ? 'ok' : ''}>
              <label className="inline">
                <input type="checkbox" checked={checked} disabled={a !== undefined} onChange={() => toggle(it.id)} />
                <span>
                  {it.text}
                  {a !== undefined && <span className="muted"> (tự kiểm tra)</span>}
                  {it.hint && <span className="muted hint">{it.hint}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
