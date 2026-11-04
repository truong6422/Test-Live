import { useEffect, useState } from 'react';
import { fmtAgo, fmtClock, GRACE_MS, usePresence } from '../presence';

/**
 * Dải nhắc dưới thanh điều khiển (không chặn màn hình): chủ phòng lâu không xác nhận có mặt,
 * game đã tự dừng vì vắng chủ phòng, hoặc hồ trống lâu khi đang LIVE.
 */
export function HostAlerts() {
  const p = usePresence();
  if (!p.active) return null;
  return (
    <>
      {p.phase === 'warn' && <WarnBanner />}
      {p.phase === 'paused' && (
        <div className="host-alert danger" role="alert">
          <span className="host-alert-icon" aria-hidden>
            ⏸
          </span>
          <span>
            <b>Game đã tự dừng vì không thấy chủ phòng xác nhận có mặt.</b> Khi rời máy hãy dùng <b>"Tạm dừng LIVE"</b> của TikTok
            hoặc kết thúc LIVE — không để LIVE chạy không người dẫn. Quay lại thì bấm "Tôi đang ở đây" rồi "Bắt đầu game".
          </span>
          <button className="primary" onClick={p.confirm}>
            Tôi đang ở đây
          </button>
        </div>
      )}
      {p.emptyRoomMin > 0 && p.phase === 'ok' && (
        <div className="host-alert" role="status">
          <span className="host-alert-icon" aria-hidden>
            🪑
          </span>
          <span>
            <b>Hồ trống và không có hoạt động nào {p.emptyRoomMin} phút.</b> Hãy trò chuyện, mời người xem bình luận để vào hồ — hoặc
            kết thúc LIVE nếu chưa có ai xem.
          </span>
        </div>
      )}
    </>
  );
}

function WarnBanner() {
  const p = usePresence();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = p.warnAt() + GRACE_MS - now;
  return (
    <div className="host-alert warn" role="alert">
      <span className="host-alert-icon" aria-hidden>
        🎙️
      </span>
      <span>
        <b>Bạn còn ở đó không?</b> Đã {fmtAgo(now - p.lastSeen()).replace(' trước', '')} không có thao tác. TikTok không cho phép LIVE
        treo máy — hãy trò chuyện với người xem. {left > 0 ? <>Game sẽ tự dừng sau <b>{fmtClock(left)}</b> nếu không xác nhận.</> : 'Đang dừng game…'}
      </span>
      <button className="primary" onClick={p.confirm}>
        Tôi đang ở đây
      </button>
    </div>
  );
}

/** Ô nhỏ trên thanh điều khiển: đồng hồ lên sóng, lần thao tác gần nhất, nút "Tôi đang ở đây". */
export function PresenceWidget() {
  const p = usePresence();
  const [now, setNow] = useState(Date.now);
  const since = p.onAir.liveSince ?? p.onAir.gameSince;
  const show = p.active || since !== null;
  useEffect(() => {
    if (!show) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [show]);
  if (!show) return null;
  const idle = now - p.lastSeen();
  return (
    <div className={`presence${p.phase !== 'ok' ? ' alerting' : ''}`}>
      {since !== null && (
        <span className="presence-clock" title={p.onAir.liveSince ? 'Thời gian từ lúc nối TikTok LIVE' : 'Thời gian từ lúc game bắt đầu chạy'}>
          <span className={p.onAir.liveSince ? 'on-air' : 'on-air off'}>{p.onAir.liveSince ? 'LÊN SÓNG' : 'GAME'}</span>
          {fmtClock(now - since)}
        </span>
      )}
      {p.active && (
        <>
          <span className="presence-idle" title="Lần cuối bạn thao tác trên trang này">
            Thao tác: {fmtAgo(idle)}
          </span>
          <button className="small" onClick={p.confirm} title="Xác nhận chủ phòng đang dẫn LIVE">
            🙋 Tôi đang ở đây
          </button>
        </>
      )}
    </div>
  );
}
