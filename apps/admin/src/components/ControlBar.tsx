import { memo } from 'react';
import type { GameSnapshot } from '@cau/shared';
import { api } from '../api';
import type { Run } from '../App';
import { useArm, useBusy } from '../hooks';
import { PresenceWidget } from './HostPresence';

export const TIKTOK_STATUS_LABEL: Record<string, string> = {
  disconnected: 'Chưa kết nối',
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  reconnecting: 'Đang kết nối lại…',
  offline: 'Kênh chưa phát LIVE (tự thử lại)',
  error: 'Lỗi (tự thử lại)'
};

export const tiktokPillClass = (status: string) =>
  status === 'connected' ? 'pill green' : status === 'disconnected' ? 'pill gray' : 'pill yellow';

export const fmtInt = (n: number) => n.toLocaleString('vi-VN');

/**
 * Thanh điều khiển dính trên cùng, hiện ở MỌI tab: trạng thái game + Bắt đầu/Dừng, kết nối TikTok,
 * chế độ DEMO (màu cảnh báo khi bật), người xem LIVE, người tham gia.
 * Dừng game khi đang nối LIVE thật phải bấm hai lần (tránh bấm nhầm giữa buổi).
 */
export const ControlBar = memo(function ControlBar({
  snap,
  run,
  wsConnected,
  onOpenConnect
}: {
  snap: GameSnapshot;
  run: Run;
  wsConnected: boolean;
  /** Mở thẻ "Kết nối TikTok LIVE" (chuyển về tab Điều khiển). */
  onOpenConnect: () => void;
}) {
  const t = snap.connectors.tiktok;
  const demo = snap.connectors.demo.running;
  const live = t.status === 'connected';
  const { busy, wrap } = useBusy();
  const stopArm = useArm();

  const start = wrap(() => run(api.startGame, 'Đã bắt đầu game'));
  const stop = wrap(async () => {
    stopArm.disarm();
    await run(api.stopGame, 'Đã dừng game');
  });
  const demoOff = wrap(() => run(() => api.demo(false), 'Đã tắt demo'));

  return (
    <div className={`control-bar${demo ? ' is-demo' : ''}`} role="region" aria-label="Điều khiển LIVE">
      <div className="cb-group">
        <span className={snap.running ? 'pill green' : 'pill gray'}>
          <span className={snap.running ? 'dot on pulse' : 'dot off'} /> {snap.running ? 'Game đang chạy' : 'Game đang dừng'}
        </span>
        {snap.running ? (
          live && !stopArm.armed ? (
            <button disabled={busy} onClick={stopArm.arm} title="Đang LIVE thật — bấm hai lần để dừng">
              Dừng game
            </button>
          ) : (
            <button className={stopArm.armed ? 'danger solid' : ''} disabled={busy} onClick={stop}>
              {stopArm.armed ? 'Bấm lần nữa để dừng' : 'Dừng game'}
            </button>
          )
        ) : (
          <button className="primary" disabled={busy} onClick={start}>
            ▶ Bắt đầu game
          </button>
        )}
      </div>
      <div className="cb-group">
        <button
          type="button"
          className={`${tiktokPillClass(t.status)} pill-btn`}
          title={t.username ? `@${t.username} — mở thẻ kết nối` : 'Mở thẻ kết nối TikTok LIVE'}
          onClick={onOpenConnect}
        >
          TikTok: {TIKTOK_STATUS_LABEL[t.status] ?? t.status}
          {live && t.username ? ` · @${t.username}` : ''}
        </button>
        {demo && (
          <>
            <span className="pill demo-on">⚠ DEMO ĐANG BẬT</span>
            <button className="danger" disabled={busy} onClick={demoOff}>
              Tắt demo
            </button>
          </>
        )}
      </div>
      <PresenceWidget />
      <dl className="cb-stats">
        <div>
          <dt>Người xem</dt>
          <dd>{fmtInt(t.viewerCount)}</dd>
        </div>
        <div>
          <dt>Tham gia</dt>
          <dd>{fmtInt(snap.participants)}</dd>
        </div>
        <div>
          <dt>Trên hồ</dt>
          <dd>{fmtInt(snap.roster.length)}</dd>
        </div>
      </dl>
      {!wsConnected && <span className="pill yellow">Mất kết nối realtime — đang thử lại…</span>}
    </div>
  );
});
