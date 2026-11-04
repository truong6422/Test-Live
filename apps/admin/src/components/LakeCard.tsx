import { memo, useState } from 'react';
import type { GameConfig, GameSnapshot, RosterMember } from '@cau/shared';
import { api } from '../api';
import type { Notify, Run } from '../App';
import { useArm, useBusy, usePolling, useServerNow } from '../hooks';
import { FishThumb } from './FishSprite';

const GROUPS: { seat: RosterMember['seat']; label: string }[] = [
  { seat: 'front', label: '⭐ Bến Vàng' },
  { seat: 'left', label: '⬅ Bờ trái' },
  { seat: 'right', label: 'Bờ phải ➡' }
];
const LAKE_POLL_MS = 2500;

/**
 * Hồ câu: đếm ngược cá to (+ gọi cá to ngay), cá to đang kéo, danh sách người đang ngồi theo chỗ
 * (Bến Vàng / Bờ trái / Bờ phải) với kg, kim cương, thời gian câu, người tới lượt và nút mời rời hồ.
 * Đồng hồ đếm ngược chạy ngay trong thẻ này (không bắt cả trang vẽ lại mỗi giây).
 */
export const LakeCard = memo(function LakeCard({
  snap,
  config,
  run,
  notify
}: {
  snap: GameSnapshot;
  config: GameConfig;
  run: Run;
  notify: Notify;
}) {
  const now = useServerNow(snap.serverTime);
  // Roster lấy từ realtime (snap.roster); "tới lượt" thay đổi mỗi chu kỳ câu → hỏi server định kỳ (dừng khi tab ẩn).
  const [nextTurnId, setNextTurnId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  usePolling(
    () =>
      void api
        .lake()
        .then((l) => {
          setNextTurnId(l.nextTurnId);
          setCapacity(l.capacity);
        })
        .catch(() => {}),
    LAKE_POLL_MS
  );
  const { busy, wrap } = useBusy();
  /** Mời rời hồ phải bấm ✕ hai lần (không dùng confirm() chặn màn hình giữa LIVE). */
  const kickArm = useArm();
  const [kickId, setKickId] = useState<string | null>(null);

  const bigFishLeft = snap.nextBigFishAt > 0 ? snap.nextBigFishAt - now : null;
  const pulling = snap.runningActions.filter((r) => r.fish);

  const kick = (m: RosterMember) => {
    if (!(kickArm.armed && kickId === m.platformId)) {
      setKickId(m.platformId);
      kickArm.arm();
      return;
    }
    kickArm.disarm();
    void wrap(() => run(() => api.kick(m.platformId).then((l) => setNextTurnId(l.nextTurnId)), `Đã mời ${m.displayName} rời hồ`))();
  };
  const callBigFish = wrap(async () => {
    const r = await run(api.bigFishNow);
    if (r) notify(r.result === 'started' ? 'Cá to xuất hiện!' : 'Đang kéo cá quà — cá to sẽ lên ngay sau');
  });

  return (
    <section className="card lake-card">
      <div className="card-head">
        <h2>🎣 Hồ câu</h2>
        <span className="pill">
          {snap.roster.length}
          {capacity ? `/${capacity}` : ''} người
        </span>
      </div>

      <div className="bigfish-bar">
        <span className="pill gold">🐋 Cá to định kỳ</span>
        <b className="countdown">{bigFishLeft === null ? 'Đang tắt' : bigFishLeft <= 0 ? 'Sắp xuất hiện!' : `còn ${fmtCountdown(bigFishLeft)}`}</b>
        {bigFishLeft !== null && (snap.bigFishShadowMs ?? 0) > 0 && (
          <span className="muted">
            {bigFishLeft <= snap.bigFishShadowMs ? 'Bóng cá to đang hiện trên hồ' : `bóng cá hiện trước ${Math.round(snap.bigFishShadowMs / 1000)}s`}
          </span>
        )}
        <span className="spacer" />
        <button
          disabled={busy || !snap.running || snap.roster.length === 0}
          title={!snap.running ? 'Game đang dừng' : snap.roster.length === 0 ? 'Hồ chưa có ai' : 'Chọn đều một người đang ngồi'}
          onClick={callBigFish}
        >
          🐋 Gọi cá to ngay
        </button>
      </div>

      {pulling.length > 0 && (
        <div className="pulling">
          <span className="pill yellow">Đang kéo cá to</span>
          {pulling.map((r) => (
            <div key={r.runId} className="pulling-item">
              <FishThumb actionId={r.actionId} name={r.fish!.name} emoji={r.fish!.emoji} size={52} actions={config.actions} />
              <div>
                <b>{r.fish!.name}</b> <span className="kg">{fmtKg(r.fish!.kg)} kg</span>
                <div className="muted">{r.actor ? r.actor.displayName : 'Cả hồ'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {snap.roster.length === 0 ? (
        <p className="empty">Hồ đang trống — người xem bình luận bất kỳ hoặc tặng quà là vào hồ ngồi câu.</p>
      ) : (
        <div className="roster-cols">
          {GROUPS.map((g) => {
            const members = snap.roster.filter((m) => m.seat === g.seat);
            return (
              <div key={g.seat} className={`roster-col seat-${g.seat}`}>
                <h3>
                  {g.label} <span className="muted">({members.length})</span>
                </h3>
                {members.length === 0 ? (
                  <p className="muted">—</p>
                ) : (
                  <ul className="roster">
                    {members.map((m) => {
                      const armed = kickArm.armed && kickId === m.platformId;
                      return (
                        <li key={m.platformId} className={m.platformId === nextTurnId ? 'next' : ''}>
                          <div className="roster-name">
                            {m.platformId === nextTurnId && (
                              <span className="turn" title="Tới lượt cá cắn câu ở chu kỳ tới">
                                ▶
                              </span>
                            )}
                            <span title={m.follower ? 'Cần thủ chính thức (đã follow)' : 'Cần thủ tập sự'}>{m.follower ? '🎩' : '🧢'}</span>{' '}
                            <b title={m.displayName}>{m.displayName}</b>
                          </div>
                          <div className="roster-meta">
                            <span>{fmtKg(m.kg)} kg</span>
                            {m.diamonds > 0 && <span>{m.diamonds.toLocaleString('vi-VN')} 💎</span>}
                            <span title="Thời gian ngồi câu trong phiên">⏱ {fmtDuration(m.fishingMs)}</span>
                            <button
                              className={armed ? 'icon danger solid' : 'icon danger'}
                              disabled={busy}
                              title={armed ? 'Bấm lần nữa để mời rời hồ' : `Mời ${m.displayName} rời hồ`}
                              aria-label={armed ? `Xác nhận mời ${m.displayName} rời hồ` : `Mời ${m.displayName} rời hồ`}
                              onClick={() => kick(m)}
                            >
                              {armed ? 'Mời rời?' : '✕'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted">
        ▶ = tới lượt cá thường cắn câu ở chu kỳ tới (lần lượt theo thứ tự vào hồ). ✕ (bấm hai lần) = mời rời hồ. Người này không vào
        lại hồ trong 10 phút.
      </p>
    </section>
  );
});

export const fmtKg = (kg: number) => (Math.round(kg * 10) / 10).toLocaleString('vi-VN');

export function fmtCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return `${Math.floor(ms / 1000)} giây`;
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, '0')}`;
}
