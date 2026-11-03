import { useEffect, useState } from 'react';
import type { CatchEvent, GameConfig, GameSnapshot, LeaderboardEntry } from '@cau/shared';
import { api } from '../api';
import type { Notify, Run } from '../App';
import { FishThumb } from '../components/FishSprite';
import { GoLiveChecklist } from '../components/GoLiveChecklist';
import { fmtKg, LakeCard } from '../components/LakeCard';
import { LivePreview } from '../components/LivePreview';
import { SessionStatsCard } from '../components/SessionStatsCard';

const STATUS_LABEL: Record<string, string> = {
  disconnected: 'Chưa kết nối',
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  reconnecting: 'Đang kết nối lại…',
  offline: 'Kênh chưa phát LIVE (tự thử lại)',
  error: 'Lỗi (tự thử lại)'
};

const COLLECTIVE_STATUS: Record<string, string> = {
  active: 'Đang diễn ra',
  completed: 'Đã kéo được!',
  expired: 'Hết giờ',
  idle: 'Chờ vòng mới'
};

export function DashboardPage({
  snap,
  catches,
  config,
  run,
  notify,
  reloadConfig
}: {
  snap: GameSnapshot;
  catches: CatchEvent[];
  config: GameConfig;
  run: Run;
  notify: Notify;
  reloadConfig: () => Promise<void>;
}) {
  const t = snap.connectors.tiktok;
  const [username, setUsername] = useState(t.username ?? '');
  const now = useServerNow(snap.serverTime);
  const [goal, setGoal] = useState(config.collective.goal);

  useEffect(() => setGoal(config.collective.goal), [config.collective.goal]);

  return (
    <div className="grid">
      <section className="card">
        <h2>Trò chơi</h2>
        <div className="row">
          <span className={snap.running ? 'pill green' : 'pill gray'}>{snap.running ? 'Đang chạy' : 'Đang dừng'}</span>
          {snap.running ? (
            <button onClick={() => run(api.stopGame, 'Đã dừng game')}>Dừng game</button>
          ) : (
            <button className="primary" onClick={() => run(api.startGame, 'Đã bắt đầu game')}>
              Bắt đầu game
            </button>
          )}
          <button
            className="danger"
            onClick={() => confirm('Kết thúc phiên LIVE hiện tại và bắt đầu phiên mới? (Bảng xếp hạng phiên sẽ về 0)') && run(api.resetSession, 'Đã reset phiên')}
          >
            Reset phiên LIVE
          </button>
        </div>
        <dl className="stats">
          <div>
            <dt>Người tham gia (phiên)</dt>
            <dd>{snap.participants}</dd>
          </div>
          <div>
            <dt>Hàng đợi</dt>
            <dd>{snap.queueLength}</dd>
          </div>
          <div>
            <dt>Đang chạy</dt>
            <dd>{snap.runningActions.map((r) => r.actionName).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>Người xem LIVE</dt>
            <dd>{t.viewerCount}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2>Kết nối TikTok LIVE</h2>
        <div className="row">
          <span className={t.status === 'connected' ? 'pill green' : t.status === 'disconnected' ? 'pill gray' : 'pill yellow'}>
            {STATUS_LABEL[t.status] ?? t.status}
          </span>
          {t.reconnectAttempt > 0 && <span className="muted">Lần thử #{t.reconnectAttempt}</span>}
        </div>
        {t.lastError && <div className="error">{t.lastError}</div>}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.connectLive(username), 'Đang kết nối…');
          }}
        >
          <input placeholder="@tenkenh hoặc link tiktok.com/@tenkenh/live" value={username} onChange={(e) => setUsername(e.target.value)} />
          <button className="primary" disabled={!username.trim()}>
            Kết nối
          </button>
          <button type="button" onClick={() => run(api.disconnectLive, 'Đã ngắt kết nối')}>
            Ngắt
          </button>
        </form>
        <div className="row">
          <span className={snap.connectors.demo.running ? 'pill yellow' : 'pill gray'}>
            Chế độ DEMO: {snap.connectors.demo.running ? 'BẬT' : 'TẮT'}
          </span>
          <button onClick={() => run(() => api.demo(!snap.connectors.demo.running))}>
            {snap.connectors.demo.running ? 'Tắt demo' : 'Bật demo'}
          </button>
        </div>
        <p className="muted">Demo sinh sự kiện giả lập (gắn nhãn DEMO trên overlay, không lưu vào bảng cần thủ).</p>
      </section>

      <GoLiveChecklist snap={snap} />

      <LivePreview run={run} notify={notify} />

      <LakeCard snap={snap} config={config} run={run} notify={notify} now={now} />

      <SessionStatsCard config={config} queueLength={snap.queueLength} sessionId={snap.sessionId} />

      <section className="card">
        <h2>🐟 Cá vừa lên</h2>
        {catches.length === 0 ? (
          <p className="muted">Chưa có mẻ nào.</p>
        ) : (
          <ul className="feed catches">
            {catches.slice(0, 15).map((c, i) => (
              <li key={`${c.at}-${c.platformId}-${i}`}>
                <FishThumb small name={c.name} emoji={c.emoji} size={28} />
                <span>
                  <b>{c.displayName}</b> — {c.name}
                  {c.kg > 0 ? <span className="kg"> {fmtKg(c.kg)} kg</span> : <span className="muted"> (rác)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>⚖️ Bảng cân cá</h2>
        <Board rows={snap.kgBoard ?? []} value={(e) => `${fmtKg(e.kg)} kg`} empty="Chưa ai câu được cá." />
      </section>

      <section className="card">
        <h2>🎁 Top quà tặng</h2>
        <Board rows={snap.leaderboard} value={(e) => `${e.diamonds ?? 0} 💎`} empty="Chưa có quà." />
      </section>

      <section className="card">
        <h2>Kích hoạt thử nghiệm</h2>
        <p className="muted">Chạy hoạt ảnh ngay (bỏ qua cooldown và bật/tắt, không cộng điểm cho ai).</p>
        <div className="row wrap">
          {config.actions.map((a) => (
            <button key={a.id} className="with-thumb" onClick={() => run(() => api.trigger(a.id), `Đã kích hoạt: ${a.name}`)}>
              {a.fish && <FishThumb actionId={a.id} name={a.fish.name} emoji={a.fish.emoji} size={24} />}
              {a.name}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Sự kiện tập thể</h2>
        {snap.collective ? (
          <>
            <div className="row">
              <b>{snap.collective.name}</b>
              <span>
                {snap.collective.progress}/{snap.collective.goal} · {snap.collective.participants} người
              </span>
              <span className="pill">{COLLECTIVE_STATUS[snap.collective.status] ?? snap.collective.status}</span>
            </div>
            <progress max={snap.collective.goal} value={snap.collective.progress} />
          </>
        ) : (
          <p className="muted">Đang tắt.</p>
        )}
        <div className="row">
          <label className="inline">
            <input
              type="checkbox"
              checked={config.collective.enabled}
              onChange={(e) => run(() => api.updateCollective({ enabled: e.target.checked }).then(reloadConfig), 'Đã lưu')}
            />
            Bật
          </label>
          <label className="inline">
            Mục tiêu
            <input type="number" min={1} value={goal} onChange={(e) => setGoal(Number(e.target.value))} style={{ width: 100 }} />
          </label>
          <button onClick={() => run(() => api.updateCollective({ goal }).then(reloadConfig), 'Đã lưu mục tiêu')}>Lưu</button>
        </div>
      </section>

      <section className="card">
        <h2>Hoạt động gần đây</h2>
        <ul className="feed">
          {snap.feed.map((f) => (
            <li key={f.id}>
              <span className={`src ${f.source}`}>{f.source}</span> <b>{f.actorName}</b> — {f.text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Đồng hồ chạy theo giờ server (bù lệch giờ máy theo snapshot.serverTime). */
function useServerNow(serverTime: number): number {
  const [offset] = useState(() => serverTime - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}

function Board({ rows, value, empty }: { rows: LeaderboardEntry[]; value: (e: LeaderboardEntry) => string; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="dense">
      <tbody>
        {rows.slice(0, 10).map((e) => (
          <tr key={e.platformId}>
            <td style={{ width: 32 }}>{e.rank}</td>
            <td>
              {e.displayName} <span className="muted">· {e.title}</span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <b>{value(e)}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
