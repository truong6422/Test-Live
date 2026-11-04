import { memo, useState } from 'react';
import type { GameConfig, SessionStats } from '@cau/shared';
import { api } from '../api';
import { usePolling } from '../hooks';
import { FishThumb } from './FishSprite';
import { fmtDuration, fmtKg } from './LakeCard';

const STATS_POLL_MS = 3000;

/** Thống kê phiên LIVE hiện tại (server giữ trong bộ nhớ — khởi động lại server thì về 0). */
export const SessionStatsCard = memo(function SessionStatsCard({
  config,
  queueLength,
  sessionId,
  running
}: {
  config: GameConfig;
  queueLength: number;
  sessionId: string | null;
  /** Tên các hoạt ảnh đang chạy (rỗng = không có). */
  running: string;
}) {
  const [s, setS] = useState<SessionStats | null>(null);
  usePolling(
    () =>
      void api
        .stats()
        .then(setS)
        .catch(() => {}),
    STATS_POLL_MS,
    [sessionId]
  );

  if (!s) {
    return (
      <section className="card">
        <h2>📊 Thống kê phiên</h2>
        <p className="empty">Đang tải…</p>
      </section>
    );
  }
  const minutes = s.activeMs / 60_000;
  const perMin = minutes >= 0.1 ? s.fishCaught / minutes : 0;

  return (
    <section className="card">
      <h2>📊 Thống kê phiên</h2>
      <dl className="stats three">
        <div>
          <dt>Cá đã câu</dt>
          <dd>
            {s.fishCaught.toLocaleString('vi-VN')}
            {s.junkCaught > 0 && <small className="muted"> +{s.junkCaught} rác</small>}
          </dd>
        </div>
        <div>
          <dt>Tổng cân</dt>
          <dd>{fmtKg(s.totalKg)} kg</dd>
        </div>
        <div>
          <dt>Cá / phút</dt>
          <dd>{perMin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</dd>
        </div>
        <div>
          <dt>Cá to đã kéo</dt>
          <dd>{s.bigFishPulled.toLocaleString('vi-VN')}</dd>
        </div>
        <div>
          <dt>Lượt quà nhận</dt>
          <dd>
            {s.giftsReceived.toLocaleString('vi-VN')}
            {s.giftDiamonds > 0 && <small className="muted"> · {s.giftDiamonds.toLocaleString('vi-VN')} 💎</small>}
          </dd>
        </div>
        <div>
          <dt>Hàng đợi</dt>
          <dd>
            {queueLength}
            {running && <small className="muted"> · đang chạy: {running}</small>}
          </dd>
        </div>
      </dl>
      <div className="biggest">
        <span className="muted">🏆 Con to nhất phiên</span>
        {s.biggest ? (
          <div className="row">
            <FishThumb name={s.biggest.name} emoji={s.biggest.emoji} size={48} actions={config.actions} />
            <div>
              <b>{s.biggest.name}</b> <span className="kg">{fmtKg(s.biggest.kg)} kg</span>
              <div className="muted">
                {s.biggest.displayName} · lúc {new Date(s.biggest.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">Chưa có cá.</p>
        )}
      </div>
      <p className="muted">Thời gian game chạy trong phiên: {fmtDuration(s.activeMs)}. Số liệu về 0 khi reset phiên hoặc khởi động lại server.</p>
    </section>
  );
});
