import { useEffect, useState } from 'react';
import type { HistoryEntry } from '@sep/shared';
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
  game_stopped: 'Game dừng',
  filtered: 'Bị chặn',
  work: 'Làm việc'
};

export function HistoryPage({ run, live }: { run: Run; live: HistoryEntry[] }) {
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [outcome, setOutcome] = useState('');
  const [session, setSession] = useState<'current' | 'all'>('current');

  const load = () => run(() => api.history({ limit: 200, outcome: outcome || undefined, session }).then(setRows));
  useEffect(() => {
    void load();
  }, [outcome, session]);

  // Gộp các bản ghi realtime mới (chưa kịp lưu DB) lên đầu.
  const ids = new Set(rows.map((r) => r.id));
  const merged = [...live.filter((h) => !ids.has(h.id) && (!outcome || h.outcome === outcome)), ...rows].slice(0, 300);

  return (
    <div className="stack">
      <h1>Lịch sử sự kiện</h1>
      <div className="row">
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Mọi kết quả</option>
          {Object.entries(OUTCOMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={session} onChange={(e) => setSession(e.target.value as 'current' | 'all')}>
          <option value="current">Phiên hiện tại</option>
          <option value="all">Mọi phiên</option>
        </select>
        <button onClick={load}>Tải lại</button>
      </div>
      <section className="card">
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
                <td>{new Date(h.createdAt).toLocaleTimeString('vi-VN')}</td>
                <td>
                  <span className={`src ${h.source}`}>{h.source}</span>
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
      </section>
    </div>
  );
}
