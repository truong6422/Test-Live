import { memo, useEffect, useState } from 'react';
import type { CatchEvent, CollectiveState, ConnectorInfo, FeedItem, GameConfig, GameSnapshot, LeaderboardEntry } from '@cau/shared';
import { api } from '../api';
import type { Notify, Run } from '../App';
import { fmtInt, TIKTOK_STATUS_LABEL, tiktokPillClass } from '../components/ControlBar';
import { FishThumb } from '../components/FishSprite';
import { GoLiveChecklist } from '../components/GoLiveChecklist';
import { fmtKg, LakeCard } from '../components/LakeCard';
import { LivePreview } from '../components/LivePreview';
import { SessionStatsCard } from '../components/SessionStatsCard';
import { TalkPrompts } from '../components/TalkPrompts';
import { useArm, useBusy } from '../hooks';

const COLLECTIVE_STATUS: Record<string, string> = {
  active: 'Đang diễn ra',
  completed: 'Đã kéo được!',
  expired: 'Hết giờ',
  idle: 'Chờ vòng mới'
};

const SOURCE_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  demo: 'Demo',
  manual: 'Thử',
  collective: 'Tập thể'
};

/** Từ phải gõ đúng để mở khoá nút reset phiên. */
const RESET_WORD = 'RESET';

/**
 * Bảng điều khiển. Thứ tự ưu tiên: thẻ vận hành LIVE trước (kết nối, checklist, xem trước, hồ câu),
 * sau đó thống kê / lịch sử / kích hoạt thử, cuối cùng là "Vùng nguy hiểm".
 * Bắt đầu / Dừng game nằm ở thanh điều khiển dính phía trên (hiện ở mọi tab).
 * Mỗi thẻ là component memo nhận đúng phần dữ liệu nó cần → tin realtime chỉ vẽ lại thẻ liên quan.
 */
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
  return (
    <div className="grid">
      {/* ---------- Vận hành LIVE ---------- */}
      <ConnectCard connectors={snap.connectors} streamOffline={!!snap.streamOffline} run={run} />

      <GoLiveChecklist snap={snap} />

      <LivePreview run={run} notify={notify} />

      <TalkPrompts catches={catches} roster={snap.roster} />

      <LakeCard snap={snap} config={config} run={run} notify={notify} />

      {/* ---------- Thống kê, lịch sử, thử nghiệm ---------- */}
      <h2 className="grid-heading">Thống kê &amp; thử nghiệm</h2>

      <SessionStatsCard config={config} queueLength={snap.queueLength} sessionId={snap.sessionId} running={snap.runningActions.map((r) => r.actionName).join(', ')} />

      <CatchesCard catches={catches} />

      <BoardCard title="⚖️ Bảng cân cá" rows={snap.kgBoard ?? []} kind="kg" empty="Chưa ai câu được cá." />

      <BoardCard title="🎁 Top quà tặng" rows={snap.leaderboard} kind="diamonds" empty="Chưa có quà." />

      <CollectiveCard collective={snap.collective} enabled={config.collective.enabled} savedGoal={config.collective.goal} run={run} reloadConfig={reloadConfig} />

      <FeedCard feed={snap.feed} />

      <TriggerCard config={config} run={run} />

      <DangerZone run={run} />
    </div>
  );
}

/** Kết nối TikTok LIVE + chế độ DEMO. */
const ConnectCard = memo(function ConnectCard({ connectors, streamOffline, run }: { connectors: ConnectorInfo; streamOffline: boolean; run: Run }) {
  const t = connectors.tiktok;
  const demo = connectors.demo.running;
  const [username, setUsername] = useState(t.username ?? '');
  // Server tự kết nối (TIKTOK_USERNAME trong .env) → điền sẵn tên kênh nếu ô đang trống.
  useEffect(() => {
    if (t.username) setUsername((u) => u || t.username!);
  }, [t.username]);
  const { busy, wrap } = useBusy();
  const disc = useArm();
  const active = t.status !== 'disconnected';

  const connect = wrap(() => run(() => api.connectLive(username.trim()), 'Đang kết nối…'));
  const disconnect = wrap(async () => {
    disc.disarm();
    await run(api.disconnectLive, 'Đã ngắt kết nối TikTok');
  });
  /** Phải tự xác nhận "không đang phát LIVE" trước khi bật demo; bật xong bỏ tick để lần sau xác nhận lại. */
  const [notLive, setNotLive] = useState(false);
  /** Server chỉ cho bật demo khi TikTok ĐÃ NGẮT hẳn (kể cả đang tự thử lại / kênh offline cũng bị từ chối 409). */
  const canDemo = t.status === 'disconnected';
  const demoOn = (profile: 'live' | 'busy') =>
    wrap(async () => {
      if (!notLive) return;
      const r = await run(() => api.demo(true, profile), profile === 'live' ? 'Đã bật demo: thử giao diện' : 'Đã bật demo: thử mọi hoạt ảnh');
      if (r) setNotLive(false);
    });
  const demoOff = wrap(() => run(() => api.demo(false), 'Đã tắt demo'));

  return (
    <section className="card connect-card" id="tiktok-connect">
      <div className="card-head">
        <h2>📡 Kết nối TikTok LIVE</h2>
        {/* TikTok báo LIVE đã kết thúc / kênh chưa phát: server tạm dừng câu tự động, cá to định kỳ, Cá Thần (game vẫn chạy). */}
        {streamOffline && (
          <span className="pill yellow" title="Câu tự động, cá to định kỳ và Cá Thần tạm dừng; tự chạy lại khi LIVE phát tiếp">
            LIVE tạm nghỉ — game tự dừng câu
          </span>
        )}
        <span className={tiktokPillClass(t.status)}>{TIKTOK_STATUS_LABEL[t.status] ?? t.status}</span>
      </div>
      {t.status === 'connected' && (
        <p className="muted">
          Đang nhận sự kiện từ <b>@{t.username}</b> · {fmtInt(t.viewerCount)} người xem
        </p>
      )}
      {t.reconnectAttempt > 0 && t.status !== 'connected' && <p className="muted">Đang thử lại lần #{t.reconnectAttempt}</p>}
      {t.lastError && t.status !== 'connected' && <div className="alert danger">{t.lastError}</div>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (username.trim()) void connect();
        }}
      >
        <input
          aria-label="Tên kênh TikTok"
          placeholder="@tenkenh hoặc link tiktok.com/@tenkenh/live"
          value={username}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button className="primary" disabled={!username.trim() || busy || demo} title={demo ? 'Tắt demo trước khi nối LIVE thật' : undefined}>
          {t.status === 'connected' ? 'Kết nối lại' : 'Kết nối'}
        </button>
        {active &&
          (disc.armed ? (
            <button type="button" className="danger solid" disabled={busy} onClick={disconnect}>
              Bấm lần nữa để ngắt
            </button>
          ) : (
            <button type="button" className="danger" disabled={busy} onClick={t.status === 'connected' ? disc.arm : disconnect}>
              Ngắt
            </button>
          ))}
      </form>

      <div className="subpanel">
        <div className="row">
          <b className="subpanel-title">Chế độ DEMO</b>
          <span className={demo ? 'pill demo-on' : 'pill gray'}>{demo ? 'ĐANG BẬT' : 'Tắt'}</span>
          <span className="spacer" />
          {demo && (
            <button className="danger" disabled={busy} onClick={demoOff}>
              Tắt demo
            </button>
          )}
        </div>
        {!demo && (
          <>
            {!canDemo && <div className="alert">Ngắt kết nối TikTok trước khi thử demo.</div>}
            <label className="inline confirm-check">
              <input
                type="checkbox"
                checked={notLive}
                disabled={!canDemo}
                onChange={(e) => setNotLive(e.target.checked)}
              />
              <span>
                Tôi <b>KHÔNG</b> đang phát LIVE bằng overlay này
              </span>
            </label>
            <div className="row">
              <button disabled={busy || !notLive || !canDemo} onClick={demoOn('live')}>
                Thử giao diện (không phát sóng)
              </button>
              <button disabled={busy || !notLive || !canDemo} onClick={demoOn('busy')}>
                Thử mọi hoạt ảnh
              </button>
            </div>
          </>
        )}
        <p className="muted">
          Sinh sự kiện giả lập để tự xem thử khi <b>chưa lên sóng</b> — không dùng khi đang LIVE (không trộn người xem giả với người
          xem thật). Overlay gắn nhãn DEMO, không lưu vào bảng cần thủ, chỉ bật được khi TikTok đã ngắt hẳn.{' '}
          <b>Thử giao diện</b>: người xem vào dần, chủ yếu bình luận, quà hiếm. <b>Thử mọi hoạt ảnh</b>: nhiều quà liên tục.
        </p>
      </div>
    </section>
  );
});

const CatchesCard = memo(function CatchesCard({ catches }: { catches: CatchEvent[] }) {
  return (
    <section className="card">
      <h2>🐟 Cá vừa lên</h2>
      {catches.length === 0 ? (
        <p className="empty">Chưa có mẻ nào — cá sẽ cắn câu khi game chạy và hồ có người.</p>
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
  );
});

const BoardCard = memo(function BoardCard({
  title,
  rows,
  kind,
  empty
}: {
  title: string;
  rows: LeaderboardEntry[];
  kind: 'kg' | 'diamonds';
  empty: string;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <table className="dense board">
          <tbody>
            {rows.slice(0, 10).map((e) => (
              <tr key={e.platformId}>
                <td className="rank">{e.rank}</td>
                <td>
                  {e.displayName} <span className="muted">· {e.title}</span>
                </td>
                <td className="num">
                  <b>{kind === 'kg' ? `${fmtKg(e.kg ?? 0)} kg` : `${fmtInt(e.diamonds ?? 0)} 💎`}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
});

const CollectiveCard = memo(function CollectiveCard({
  collective,
  enabled,
  savedGoal,
  run,
  reloadConfig
}: {
  collective: CollectiveState | null;
  enabled: boolean;
  savedGoal: number;
  run: Run;
  reloadConfig: () => Promise<void>;
}) {
  const [goal, setGoal] = useState(String(savedGoal));
  useEffect(() => setGoal(String(savedGoal)), [savedGoal]);
  const { busy, wrap } = useBusy();
  const goalNum = Number(goal);
  const goalOk = Number.isInteger(goalNum) && goalNum >= 1;
  const dirty = goalOk && goalNum !== savedGoal;

  return (
    <section className="card">
      <h2>🤝 Sự kiện tập thể</h2>
      <p className="muted">Cả hồ cùng góp sức bằng tương tác miễn phí — quà tặng không cộng vào mục tiêu.</p>
      {collective ? (
        <>
          <div className="row">
            <b>{collective.name}</b>
            <span className="pill">{COLLECTIVE_STATUS[collective.status] ?? collective.status}</span>
            <span className="spacer" />
            <span className="muted">
              {fmtInt(collective.progress)}/{fmtInt(collective.goal)} · {fmtInt(collective.participants)} người
            </span>
          </div>
          <progress max={collective.goal} value={collective.progress} />
        </>
      ) : (
        <p className="empty">{enabled ? 'Chưa có vòng nào.' : 'Đang tắt.'}</p>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void wrap(() => run(() => api.updateCollective({ goal: goalNum }).then(reloadConfig), 'Đã lưu mục tiêu'))();
        }}
      >
        <label className="inline">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => {
              const on = e.target.checked;
              void wrap(() => run(() => api.updateCollective({ enabled: on }).then(reloadConfig), on ? 'Đã bật sự kiện tập thể' : 'Đã tắt sự kiện tập thể'))();
            }}
          />
          Bật
        </label>
        <label className="inline">
          Mục tiêu
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            className={goalOk ? 'num-input' : 'num-input invalid'}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <button disabled={!dirty || busy}>Lưu</button>
      </form>
      {!goalOk && <div className="error">Mục tiêu là số nguyên ≥ 1</div>}
    </section>
  );
});

const FeedCard = memo(function FeedCard({ feed }: { feed: FeedItem[] }) {
  return (
    <section className="card">
      <h2>🕑 Hoạt động gần đây</h2>
      {feed.length === 0 ? (
        <p className="empty">Chưa có hoạt động.</p>
      ) : (
        <ul className="feed">
          {feed.map((f) => (
            <li key={f.id}>
              <span className={`src ${f.source}`}>{SOURCE_LABEL[f.source] ?? f.source}</span> <b>{f.actorName}</b> — {f.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

const TriggerCard = memo(function TriggerCard({ config, run }: { config: GameConfig; run: Run }) {
  const { busy, wrap } = useBusy();
  return (
    <section className="card">
      <h2>🧪 Kích hoạt thử nghiệm</h2>
      <p className="muted">
        Chạy hoạt ảnh ngay (bỏ qua cooldown và bật/tắt, không cộng điểm cho ai). <b>Đang LIVE thật thì người xem cũng thấy.</b>
      </p>
      <div className="row wrap">
        {config.actions.map((a) => (
          <button
            key={a.id}
            className="with-thumb"
            disabled={busy}
            onClick={wrap(() => run(() => api.trigger(a.id), `Đã kích hoạt: ${a.name}`))}
          >
            {a.fish && <FishThumb actionId={a.id} name={a.fish.name} emoji={a.fish.emoji} size={24} />}
            {a.name}
          </button>
        ))}
      </div>
    </section>
  );
});

/** Vùng nguy hiểm: reset phiên LIVE — phải gõ đúng RESET mới bấm được (không dùng hộp thoại confirm). */
const DangerZone = memo(function DangerZone({ run }: { run: Run }) {
  const [typed, setTyped] = useState('');
  const { busy, wrap } = useBusy();
  const armed = typed.trim().toUpperCase() === RESET_WORD;
  return (
    <section className="card danger-zone">
      <h2>⚠️ Vùng nguy hiểm</h2>
      <p className="muted">
        <b>Reset phiên LIVE</b>: kết thúc phiên hiện tại và mở phiên mới — <b>bảng cân cá và top quà tặng của phiên về 0</b>. Không hoàn tác
        được. Chỉ làm khi bắt đầu một buổi LIVE mới.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!armed) return;
          void wrap(async () => {
            const r = await run(api.resetSession, 'Đã reset phiên LIVE');
            if (r) setTyped('');
          })();
        }}
      >
        <label className="inline">
          Gõ <code>{RESET_WORD}</code> để xác nhận
          <input
            className="confirm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={RESET_WORD}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label={`Gõ ${RESET_WORD} để mở khoá nút reset phiên`}
          />
        </label>
        <button className="danger solid" disabled={!armed || busy}>
          Reset phiên LIVE
        </button>
      </form>
    </section>
  );
});
