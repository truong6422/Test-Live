import { useEffect, useState } from 'react';
import type { GameConfig, GameSnapshot, RosterMember } from '@cau/shared';
import { api } from '../api';
import type { Notify, Run } from '../App';
import { FishThumb } from './FishSprite';

const GROUPS: { seat: RosterMember['seat']; label: string }[] = [
  { seat: 'front', label: '⭐ Chiếu VIP' },
  { seat: 'left', label: '⬅ Bờ trái' },
  { seat: 'right', label: 'Bờ phải ➡' }
];
const LAKE_POLL_MS = 2500;

/**
 * Hồ câu: đếm ngược cá to (+ gọi cá to ngay), cá to đang kéo, danh sách người đang ngồi theo chỗ
 * (Chiếu VIP / Bờ trái / Bờ phải) với kg, kim cương, thời gian câu, người tới lượt và nút mời rời hồ.
 */
export function LakeCard({
  snap,
  config,
  run,
  notify,
  now
}: {
  snap: GameSnapshot;
  config: GameConfig;
  run: Run;
  notify: Notify;
  now: number;
}) {
  // Roster lấy từ realtime (snap.roster); "tới lượt" thay đổi mỗi chu kỳ câu → hỏi server định kỳ.
  const [nextTurnId, setNextTurnId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState(50);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .lake()
        .then((l) => {
          if (!alive) return;
          setNextTurnId(l.nextTurnId);
          setCapacity(l.capacity);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, LAKE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [snap.roster.length]);

  const bigFishLeft = snap.nextBigFishAt > 0 ? snap.nextBigFishAt - now : null;
  const pulling = snap.runningActions.filter((r) => r.fish);

  const kick = (m: RosterMember) => {
    if (!confirm(`Mời "${m.displayName}" rời hồ?\nNgười này không tự vào lại bằng bình luận trong 10 phút (tặng quà thì vẫn vào).`)) return;
    void run(() => api.kick(m.platformId).then((l) => setNextTurnId(l.nextTurnId)), `Đã mời ${m.displayName} rời hồ`);
  };

  return (
    <section className="card lake-card">
      <div className="row">
        <h2 style={{ flex: 1, margin: 0 }}>🎣 Hồ câu</h2>
        <span className="pill">
          {snap.roster.length}/{capacity} người
        </span>
      </div>

      <div className="row">
        <span className="pill tier">🐋 Cá to định kỳ</span>
        <b>{bigFishLeft === null ? 'Đang tắt' : bigFishLeft <= 0 ? 'Sắp xuất hiện!' : `còn ${fmtCountdown(bigFishLeft)}`}</b>
        {bigFishLeft !== null && (snap.bigFishShadowMs ?? 0) > 0 && (
          <span className="muted">
            {bigFishLeft <= snap.bigFishShadowMs ? 'Bóng cá to đang hiện trên hồ' : `bóng cá hiện trước ${Math.round(snap.bigFishShadowMs / 1000)}s`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          disabled={!snap.running || snap.roster.length === 0}
          title={!snap.running ? 'Game đang dừng' : snap.roster.length === 0 ? 'Hồ chưa có ai' : 'Chọn đều một người đang ngồi'}
          onClick={async () => {
            const r = await run(api.bigFishNow);
            if (r) notify(r.result === 'started' ? 'Cá to xuất hiện!' : 'Đang kéo cá quà — cá to sẽ lên ngay sau');
          }}
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
        <p className="muted">Hồ đang trống — bình luận bất kỳ hoặc tặng quà để vào hồ ngồi câu.</p>
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
                    {members.map((m) => (
                      <li key={m.platformId} className={m.platformId === nextTurnId ? 'next' : ''}>
                        <div className="roster-name">
                          {m.platformId === nextTurnId && (
                            <span className="turn" title="Tới lượt cá cắn câu ở chu kỳ tới">
                              ▶
                            </span>
                          )}
                          <span title={m.follower ? 'Cần thủ chính thức (đã follow)' : 'Cần thủ tập sự'}>{m.follower ? '🎩' : '🧢'}</span>{' '}
                          <b>{m.displayName}</b>
                        </div>
                        <div className="roster-meta">
                          <span>{fmtKg(m.kg)} kg</span>
                          {m.diamonds > 0 && <span>{m.diamonds} 💎</span>}
                          <span title="Thời gian ngồi câu trong phiên">⏱ {fmtDuration(m.fishingMs)}</span>
                          <button className="icon danger" title="Mời rời hồ" onClick={() => kick(m)}>
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted">▶ = người tới lượt cá thường cắn câu ở chu kỳ tới (lần lượt theo thứ tự vào hồ). ✕ = mời rời hồ.</p>
    </section>
  );
}

export const fmtKg = (kg: number) => (Math.round(kg * 10) / 10).toLocaleString('vi-VN');

export function fmtCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return `${Math.floor(ms / 1000)}s`;
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}
