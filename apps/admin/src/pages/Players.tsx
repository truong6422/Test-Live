import { useEffect, useState } from 'react';
import type { GameSnapshot, LeaderboardEntry } from '@sep/shared';
import { api } from '../api';
import type { Run } from '../App';

export function PlayersPage({ run, snap }: { run: Run; snap: GameSnapshot }) {
  const [scope, setScope] = useState<'session' | 'total'>('session');
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    void run(() => api.leaderboard(scope).then(setRows));
    // Bảng phiên cập nhật theo realtime; bảng tổng tải khi mở.
  }, [scope, scope === 'session' ? snap.leaderboard : null]);

  return (
    <div className="stack">
      <h1>Nhân viên</h1>
      <div className="row">
        <button className={scope === 'session' ? 'primary' : ''} onClick={() => setScope('session')}>
          Phiên LIVE này ({snap.participants})
        </button>
        <button className={scope === 'total' ? 'primary' : ''} onClick={() => setScope('total')}>
          Thành tích tổng hợp
        </button>
      </div>
      <p className="muted">
        Xếp hạng "phá Sếp": kim cương đã tặng giảm dần, rồi tới điểm, rồi lượt tham gia. Điểm chỉ dùng trong trò chơi, không quy đổi thành
        tiền hay phần thưởng thật.
      </p>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Tên</th>
              <th>Danh hiệu</th>
              <th>Kim cương đã tặng</th>
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
