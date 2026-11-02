import { useEffect, useState } from 'react';
import { MOOD_LABELS, type GameConfig, type GameSnapshot } from '@sep/shared';
import { api } from '../api';
import type { Run } from '../App';

const STATUS_LABEL: Record<string, string> = {
  disconnected: 'Chưa kết nối',
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  reconnecting: 'Đang kết nối lại…',
  offline: 'Kênh chưa phát LIVE (tự thử lại)',
  error: 'Lỗi (tự thử lại)'
};

export function DashboardPage({
  snap,
  config,
  run,
  reloadConfig
}: {
  snap: GameSnapshot;
  config: GameConfig;
  run: Run;
  reloadConfig: () => Promise<void>;
}) {
  const t = snap.connectors.tiktok;
  const [username, setUsername] = useState(t.username ?? '');
  const [calm, setCalm] = useState(Math.round(snap.boss.calm));
  const [goal, setGoal] = useState(config.collective.goal);
  const overlayUrl = `${location.origin}/overlay/?key=<OVERLAY_KEY>`;

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
        <p className="muted">
          Overlay OBS: <code>{overlayUrl}</code> (Browser Source 1080×1920)
        </p>
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
        <p className="muted">Demo sinh sự kiện giả lập (gắn nhãn DEMO trên overlay, không lưu vào bảng nhân viên).</p>
      </section>

      <section className="card">
        <h2>Sếp</h2>
        <div className="row">
          <span className="pill">{MOOD_LABELS[snap.boss.mood]}</span>
          <span>Bình tĩnh: {Math.round(snap.boss.calm)}</span>
          <span>Chịu đựng: {Math.round(snap.boss.stamina)}</span>
        </div>
        <div className="row">
          <input type="range" min={0} max={100} value={calm} onChange={(e) => setCalm(Number(e.target.value))} />
          <span>{calm}</span>
          <button onClick={() => run(() => api.setCalm(calm), 'Đã chỉnh độ bình tĩnh')}>Đặt độ bình tĩnh</button>
        </div>
      </section>

      <section className="card">
        <h2>Kích hoạt thử nghiệm</h2>
        <p className="muted">Chạy hoạt ảnh ngay (bỏ qua cooldown và bật/tắt, không cộng điểm cho ai).</p>
        <div className="row wrap">
          {config.actions.map((a) => (
            <button key={a.id} onClick={() => run(() => api.trigger(a.id), `Đã kích hoạt: ${a.name}`)}>
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
              <span className="pill">{snap.collective.status}</span>
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
