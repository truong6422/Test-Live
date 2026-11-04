import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryEntry } from '@cau/shared';
import { api } from '../api';
import type { Run } from '../App';

const OUTCOMES: Record<string, string> = {
  accepted: 'Kích hoạt',
  participated: 'Tham gia',
  deduped: 'Trùng',
  rate_limited: 'Quá tần suất',
  cooldown: 'Hồi chiêu',
  disabled: 'Đang tắt',
  dropped: 'Bị bỏ (hàng đợi đầy)',
  expired: 'Chờ quá lâu',
  // Bình luận lúc game tạm dừng: người xem vẫn vào hồ / được tính hoạt động, chỉ không kích hoạt việc vui / hành động.
  game_stopped: 'Vào hồ (game tạm dừng)',
  filtered: 'Bị chặn',
  work: 'Biểu cảm bình luận'
};

const SOURCE_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  demo: 'Demo',
  manual: 'Thử',
  collective: 'Tập thể'
};

const PAGE = 200;
const SHOW_MAX = 300;

/**
 * Lịch sử sự kiện: tải từ DB theo bộ lọc + gộp các bản ghi realtime mới lên đầu.
 * `epoch` đổi (WS kết nối lại) → tải lại để lấp chỗ trống lúc mất kết nối.
 */
export function HistoryPage({ run, live, epoch }: { run: Run; live: HistoryEntry[]; epoch: number }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [outcome, setOutcome] = useState('');
  const [session, setSession] = useState<'current' | 'all'>('current');
  const [loading, setLoading] = useState(false);
  /** Chỉ nhận kết quả của lần tải mới nhất (đổi bộ lọc liên tiếp không bị kết quả cũ ghi đè). */
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    const r = await run(() => api.history({ limit: PAGE, outcome: outcome || undefined, session }));
    if (my !== seq.current) return;
    setLoading(false);
    if (r) setRows(r);
  }, [run, outcome, session]);

  useEffect(() => {
    void load();
  }, [load, epoch]);

  const merged = useMemo(() => {
    const base = rows ?? [];
    const ids = new Set(base.map((r) => r.id));
    return [...live.filter((h) => !ids.has(h.id) && (!outcome || h.outcome === outcome)), ...base].slice(0, SHOW_MAX);
  }, [rows, live, outcome]);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Lịch sử sự kiện</h1>
        <p className="muted">Mọi sự kiện server nhận được và kết quả xử lý. Bản ghi mới tự thêm lên đầu.</p>
      </div>
      <div className="toolbar">
        <select aria-label="Lọc theo kết quả" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Mọi kết quả</option>
          {Object.entries(OUTCOMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Phạm vi" value={session} onChange={(e) => setSession(e.target.value as 'current' | 'all')}>
          <option value="current">Phiên hiện tại</option>
          <option value="all">Mọi phiên</option>
        </select>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? 'Đang tải…' : 'Tải lại'}
        </button>
        <span className="muted">{merged.length > 0 && `${merged.length.toLocaleString('vi-VN')} dòng`}</span>
      </div>
      <section className="card">
        {rows === null ? (
          <p className="empty">Đang tải…</p>
        ) : merged.length === 0 ? (
          <p className="empty">Chưa có sự kiện nào{outcome ? ` với kết quả "${OUTCOMES[outcome] ?? outcome}"` : ''}.</p>
        ) : (
          <div className="table-scroll">
            <table className="dense">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Nguồn</th>
                  <th>Người</th>
                  <th>Hành động</th>
                  <th>Kết quả</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((h) => (
                  <tr key={h.id}>
                    <td className="nowrap">{fmtTime(h.createdAt, session === 'all')}</td>
                    <td>
                      <span className={`src ${h.source}`}>{SOURCE_LABEL[h.source] ?? h.source}</span>
                    </td>
                    <td>{h.actorName}</td>
                    <td>{h.actionId ?? '—'}</td>
                    <td>
                      <span className={`outcome ${h.outcome}`}>{OUTCOMES[h.outcome] ?? h.outcome}</span>
                    </td>
                    <td className="muted">{h.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const fmtTime = (at: number, withDate: boolean) =>
  new Date(at).toLocaleString('vi-VN', withDate ? { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' });
