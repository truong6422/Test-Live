import { useEffect, useState } from 'react';
import type { GameSnapshot, LeaderboardEntry } from '@cau/shared';
import { api } from '../api';
import type { Run } from '../App';

/** Danh hiệu cần thủ (PlayerTitle) — server tự gán, ở đây chỉ để giải thích. */
const TITLES: [string, string][] = [
  ['Cần thủ tập sự', 'mặc định'],
  ['Cần thủ chăm chỉ', '≥ 20 lần câu'],
  ['Sát thủ cá to', 'từng câu được cá ≥ 10 kg'],
  ['Kẻ phá hồ', '≥ 10 lượt hành động bằng quà'],
  ['Kẻ săn Cá Thần', 'góp sức "Cả hồ kéo Cá Thần"']
];

export function PlayersPage({ run, snap }: { run: Run; snap: GameSnapshot }) {
  const [scope, setScope] = useState<'session' | 'total'>('session');
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    void run(() => api.leaderboard(scope).then(setRows));
    // Bảng phiên cập nhật theo realtime; bảng tổng tải khi mở.
  }, [scope, scope === 'session' ? snap.leaderboard : null]);

  return (
    <div className="stack">
      <h1>Cần thủ</h1>
      <div className="row">
        <button className={scope === 'session' ? 'primary' : ''} onClick={() => setScope('session')}>
          Phiên LIVE này ({snap.participants})
        </button>
        <button className={scope === 'total' ? 'primary' : ''} onClick={() => setScope('total')}>
          Thành tích tổng hợp
        </button>
      </div>
      <p className="muted">
        Xếp hạng "TOP QUÀ TẶNG": kim cương đã tặng giảm dần, rồi tới điểm, rồi lượt tham gia (bảng cân cá xem ở trang Điều khiển). Điểm chỉ dùng trong trò chơi, không quy đổi thành
        tiền hay phần thưởng thật.
      </p>
      <section className="card">
        <div className="row wrap">
          {TITLES.map(([label, hint]) => (
            <span key={label} className="pill tier" title={hint}>
              {label} <span className="muted">— {hint}</span>
            </span>
          ))}
        </div>
      </section>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Tên</th>
              <th>Danh hiệu</th>
              <th>Kim cương đã tặng</th>
              <th>Cân cá (kg)</th>
              <th>Lượt tham gia</th>
              <th>Điểm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.platformId}>
                <td>{r.rank}</td>
                <td>{r.displayName}</td>
                <td>{r.title}</td>
                <td>
                  <b>{r.diamonds ?? 0}</b>
                </td>
                <td>{(Math.round((r.kg ?? 0) * 10) / 10).toLocaleString('vi-VN')}</td>
                <td>{r.participations}</td>
                <td>
                  {r.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
