import { useRef, useState } from 'react';
import type { GameSnapshot, LeaderboardEntry } from '@cau/shared';
import { api } from '../api';
import type { Run } from '../App';
import { fmtKg } from '../components/LakeCard';
import { usePolling } from '../hooks';

/** Bảng phiên: hỏi lại định kỳ (trước đây hỏi lại MỖI tin realtime 'leaderboard' → dồn request khi LIVE đông). */
const SESSION_POLL_MS = 5000;

/**
 * Danh hiệu cần thủ (PlayerTitle) — server tự gán (computeTitle trong apps/server/src/players/players.ts),
 * ở đây chỉ để giải thích. Xếp theo thứ tự ưu tiên: đạt nhiều mốc thì lấy danh hiệu đứng trước.
 */
const TITLES: [string, string][] = [
  ['Kẻ phá hồ', '≥ 30 lượt việc vui bằng bình luận (lượt đang hồi chiêu và quà không tính)'],
  ['Kẻ săn Cá Thần', 'có bình luận góp sức trong lượt "Cả hồ kéo Cá Thần" thành công'],
  ['Sát thủ cá to', 'từng có con cá ≥ 10 kg (không tính cá kéo bằng quà)'],
  ['Cần thủ chăm chỉ', '≥ 20 con câu tự động'],
  ['Cần thủ tập sự', 'mặc định']
];

export function PlayersPage({ run, snap }: { run: Run; snap: GameSnapshot }) {
  const [scope, setScopeState] = useState<'session' | 'total'>('session');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const setScope = (s: 'session' | 'total') => {
    if (s === scope) return;
    setRows(null);
    setScopeState(s);
  };

  const load = () => {
    const my = ++seq.current;
    api
      .leaderboard(scope)
      .then((r) => {
        if (my !== seq.current) return;
        setRows(r);
        setErr('');
      })
      .catch((e: unknown) => my === seq.current && setErr(e instanceof Error ? e.message : String(e)));
  };
  // Bảng tổng: tải một lần khi mở; bảng phiên: cập nhật mỗi vài giây.
  usePolling(load, scope === 'session' ? SESSION_POLL_MS : 3_600_000, [scope]);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Cần thủ</h1>
        <p className="muted">
          Xếp hạng "TOP QUÀ TẶNG": kim cương đã tặng giảm dần, rồi tới điểm, rồi lượt tham gia (bảng cân cá xem ở trang Điều khiển).
          Điểm chỉ dùng trong trò chơi, không quy đổi thành tiền hay phần thưởng thật.
        </p>
      </div>
      <div className="segmented" role="tablist" aria-label="Phạm vi xếp hạng">
        <button role="tab" aria-selected={scope === 'session'} className={scope === 'session' ? 'active' : ''} onClick={() => setScope('session')}>
          Phiên LIVE này ({snap.participants.toLocaleString('vi-VN')})
        </button>
        <button role="tab" aria-selected={scope === 'total'} className={scope === 'total' ? 'active' : ''} onClick={() => setScope('total')}>
          Thành tích tổng hợp
        </button>
      </div>
      <section className="card">
        <h2>Danh hiệu</h2>
        <p className="muted">Server tự gán theo thống kê; đạt nhiều mốc thì lấy danh hiệu đứng trước.</p>
        <div className="row wrap">
          {TITLES.map(([label, hint]) => (
            <span key={label} className="pill tier" title={hint}>
              {label} <span className="muted">— {hint}</span>
            </span>
          ))}
        </div>
      </section>
      <section className="card">
        {err && (
          <div className="alert danger">
            {err}{' '}
            <button className="small" onClick={() => void run(async () => load())}>
              Thử lại
            </button>
          </div>
        )}
        {rows === null ? (
          <p className="empty">Đang tải…</p>
        ) : rows.length === 0 ? (
          <p className="empty">{scope === 'session' ? 'Phiên này chưa có cần thủ nào.' : 'Chưa có dữ liệu.'}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tên</th>
                  <th>Danh hiệu</th>
                  <th className="num">Kim cương đã tặng</th>
                  <th className="num">Cân cá (kg)</th>
                  <th className="num">Lượt tham gia</th>
                  <th className="num">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.platformId}>
                    <td className="rank">{r.rank}</td>
                    <td>{r.displayName}</td>
                    <td className="muted">{r.title}</td>
                    <td className="num">
                      <b>{(r.diamonds ?? 0).toLocaleString('vi-VN')}</b>
                    </td>
                    <td className="num">{fmtKg(r.kg ?? 0)}</td>
                    <td className="num">{r.participations.toLocaleString('vi-VN')}</td>
                    <td className="num">{r.points.toLocaleString('vi-VN')}</td>
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
