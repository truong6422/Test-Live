import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameConfig } from '@cau/shared';
import { api, ApiError, setUnauthorizedHandler } from './api';
import { ControlBar } from './components/ControlBar';
import { HostAlerts } from './components/HostPresence';
import { ActionsPage } from './pages/Actions';
import { BlocklistPage } from './pages/Blocklist';
import { DashboardPage } from './pages/Dashboard';
import { FishingPage } from './pages/Fishing';
import { GiftsPage } from './pages/Gifts';
import { HistoryPage } from './pages/History';
import { PlayersPage } from './pages/Players';
import { WorkPage } from './pages/Work';
import { useArm, useBusy } from './hooks';
import { PresenceProvider } from './presence';
import { useLive } from './useLive';

type Tab = 'dashboard' | 'actions' | 'gifts' | 'fishing' | 'work' | 'blocklist' | 'history' | 'players';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Điều khiển' },
  { id: 'actions', label: 'Cá to (quà)' },
  { id: 'gifts', label: 'Bảng quà' },
  { id: 'fishing', label: 'Câu tự động' },
  { id: 'work', label: 'Biểu cảm bình luận' },
  { id: 'blocklist', label: 'Bộ lọc từ' },
  { id: 'history', label: 'Lịch sử' },
  { id: 'players', label: 'Cần thủ' }
];

export type Notify = (msg: string, kind?: 'ok' | 'error') => void;
export type Run = <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;

type Toast = { id: number; msg: string; kind: 'ok' | 'error' };
/** Thông báo thành công tự ẩn sau chừng này; thông báo lỗi giữ đến khi người dùng đóng. */
const TOAST_OK_MS = 3500;
const TOAST_MAX = 4;

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));
/** Tab đang mở nằm trong #hash → tải lại trang (F5 giữa LIVE) vẫn ở đúng tab. */
const tabFromHash = (): Tab => {
  const h = location.hash.slice(1);
  return TAB_IDS.has(h) ? (h as Tab) : 'dashboard';
};

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [configErr, setConfigErr] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const toastSeq = useRef(0);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Hết phiên đăng nhập (cookie 12 giờ) ở bất kỳ lệnh API / lần hỏi định kỳ / WS nào → về màn đăng nhập.
  const authLost = useCallback(() => {
    setAuthed((a) => {
      if (a) setSessionExpired(true);
      return false;
    });
  }, []);
  useEffect(() => {
    setUnauthorizedHandler(authLost);
    return () => setUnauthorizedHandler(null);
  }, [authLost]);

  const live = useLive(authed === true, authLost);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  const reloadConfig = useCallback(
    () =>
      api.config().then((c) => {
        setConfig(c);
        setConfigErr('');
      }),
    []
  );
  useEffect(() => {
    if (!authed) {
      setConfig(null);
      return;
    }
    reloadConfig().catch((e: unknown) => setConfigErr(e instanceof Error ? e.message : String(e)));
  }, [authed, reloadConfig]);

  const toastTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = toastTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  const closeToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const notify: Notify = useCallback(
    (msg, kind = 'ok') => {
      const id = ++toastSeq.current;
      setToasts((ts) => [...ts.filter((x) => x.msg !== msg), { id, msg, kind }].slice(-TOAST_MAX));
      if (kind === 'ok') {
        const t = setTimeout(() => {
          toastTimers.current.delete(t);
          closeToast(id);
        }, TOAST_OK_MS);
        toastTimers.current.add(t);
      }
    },
    [closeToast]
  );

  // Tiêu đề tab trình duyệt cho biết trạng thái khi chuyển sang cửa sổ OBS.
  const snap = live.snap;
  const titleState = !snap
    ? ''
    : snap.connectors.demo.running
      ? 'DEMO · '
      : snap.connectors.tiktok.status === 'connected'
        ? snap.running
          ? '● LIVE · '
          : '❚❚ Dừng · '
        : '';
  useEffect(() => {
    document.title = `${titleState}ĐI CÂU THÔI! — Quản trị`;
  }, [titleState]);

  const openConnect = useCallback(() => {
    setTab('dashboard');
    requestAnimationFrame(() => {
      const el = document.getElementById('tiktok-connect');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector('input')?.focus({ preventScroll: true });
    });
  }, [setTab]);

  const run: Run = useCallback(
    async (fn, okMsg) => {
      try {
        const r = await fn();
        if (okMsg) notify(okMsg);
        return r;
      } catch (err) {
        // 401 đã được xử lý chung (setUnauthorizedHandler) → không cần thêm thông báo lỗi.
        if (err instanceof ApiError && err.status === 401) return undefined;
        notify(err instanceof Error ? err.message : String(err), 'error');
        return undefined;
      }
    },
    [notify]
  );

  if (authed === null) return <div className="center muted">Đang tải…</div>;
  if (!authed)
    return (
      <Login
        expired={sessionExpired}
        onDone={() => {
          setSessionExpired(false);
          setAuthed(true);
        }}
      />
    );

  const isLive = !!snap && snap.connectors.tiktok.status === 'connected' && !snap.connectors.demo.running;

  return (
    <PresenceProvider snap={snap} run={run} notify={notify}>
    <div className="layout">
      <aside>
        <div className="brand">
          <span className="brand-icon" aria-hidden>
            🎣
          </span>
          <span>
            ĐI CÂU <span className="brand-accent">THÔI!</span>
            <small>Bảng điều khiển</small>
          </span>
        </div>
        <nav aria-label="Các trang quản trị">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ws-state" title="Kết nối realtime giữa trang này và server game">
          <span className={live.connected ? 'dot on' : 'dot off'} /> <span className="ws-label">{live.connected ? 'Realtime ổn định' : 'Mất kết nối, đang thử lại…'}</span>
        </div>
        <LogoutButton run={run} live={isLive} onDone={() => setAuthed(false)} />
      </aside>
      <main>
        {snap && <ControlBar snap={snap} run={run} wsConnected={live.connected} onOpenConnect={openConnect} />}
        <HostAlerts />
        {configErr && !config ? (
          <div className="card empty-state">
            <h2>Không tải được cấu hình</h2>
            <p className="muted">{configErr}</p>
            <div className="row">
              <button className="primary" onClick={() => reloadConfig().catch((e: unknown) => setConfigErr(e instanceof Error ? e.message : String(e)))}>
                Thử lại
              </button>
            </div>
          </div>
        ) : !snap || !config ? (
          <div className="loading-block muted">{live.connected || snap ? 'Đang tải cấu hình…' : 'Đang kết nối tới server game…'}</div>
        ) : (
          <>
            {tab === 'dashboard' && (
              <DashboardPage snap={snap} catches={live.catches} config={config} run={run} notify={notify} reloadConfig={reloadConfig} />
            )}
            {/* Trang cấu hình giữ nguyên khi chuyển tab (ẩn đi, không huỷ) → sửa dở không mất khi qua tab khác xem hồ. */}
            <KeepAlive id="actions" tab={tab}>
              <ActionsPage config={config} run={run} reloadConfig={reloadConfig} />
            </KeepAlive>
            <KeepAlive id="gifts" tab={tab}>
              <GiftsPage config={config} run={run} reloadConfig={reloadConfig} liveHistory={live.history} />
            </KeepAlive>
            <KeepAlive id="fishing" tab={tab}>
              <FishingPage config={config} run={run} notify={notify} reloadConfig={reloadConfig} />
            </KeepAlive>
            <KeepAlive id="work" tab={tab}>
              <WorkPage config={config} run={run} notify={notify} reloadConfig={reloadConfig} />
            </KeepAlive>
            <KeepAlive id="blocklist" tab={tab}>
              <BlocklistPage config={config} run={run} reloadConfig={reloadConfig} />
            </KeepAlive>
            {tab === 'history' && <HistoryPage run={run} live={live.history} epoch={live.epoch} />}
            {tab === 'players' && <PlayersPage run={run} snap={snap} />}
          </>
        )}
      </main>
      <div className="toasts">
        {/* Hai vùng aria-live luôn có sẵn trong DOM để trình đọc màn hình bắt được thông báo mới. */}
        <div role="status" aria-live="polite">
          {toasts
            .filter((x) => x.kind === 'ok')
            .map((x) => (
              <ToastItem key={x.id} toast={x} onClose={closeToast} />
            ))}
        </div>
        <div role="alert" aria-live="assertive">
          {toasts
            .filter((x) => x.kind === 'error')
            .map((x) => (
              <ToastItem key={x.id} toast={x} onClose={closeToast} />
            ))}
        </div>
      </div>
    </div>
    </PresenceProvider>
  );
}

/** Một thông báo; bấm vào (hoặc nút ×) để đóng. */
function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  return (
    <div className={`toast ${toast.kind}`} onClick={() => onClose(toast.id)}>
      <span>{toast.msg}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Đóng thông báo"
        onClick={(e) => {
          e.stopPropagation();
          onClose(toast.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

/** Trang đã mở ít nhất một lần thì giữ trong DOM (ẩn) để không mất phần sửa dở. */
function KeepAlive({ id, tab, children }: { id: Tab; tab: Tab; children: ReactNode }) {
  const [visited, setVisited] = useState(id === tab);
  if (!visited && id === tab) setVisited(true);
  if (!visited) return null;
  return (
    <div hidden={id !== tab} className="page">
      {children}
    </div>
  );
}

/** Đăng xuất. Đang LIVE thật thì phải bấm hai lần (đăng xuất không dừng game nhưng mất bảng điều khiển). */
function LogoutButton({ run, live, onDone }: { run: Run; live: boolean; onDone: () => void }) {
  const { armed, arm, disarm } = useArm();
  const { busy, wrap } = useBusy();
  const doLogout = wrap(async () => {
    disarm();
    await run(api.logout);
    onDone();
  });
  return (
    <button className={armed ? 'ghost logout armed' : 'ghost logout'} disabled={busy} onClick={live && !armed ? arm : doLogout}>
      {armed ? 'Bấm lần nữa để đăng xuất' : 'Đăng xuất'}
    </button>
  );
}

function Login({ onDone, expired }: { onDone: () => void; expired: boolean }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="center login-screen">
      <form
        className="card login"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setErr('');
          try {
            await api.login(pw);
            onDone();
          } catch (ex) {
            setErr(ex instanceof ApiError && ex.status === 401 ? 'Sai mật khẩu' : ex instanceof Error ? ex.message : 'Lỗi');
            setBusy(false);
          }
        }}
      >
        <div className="login-brand">
          <span aria-hidden>🎣</span>
          <div>
            <h1>
              ĐI CÂU <span className="brand-accent">THÔI!</span>
            </h1>
            <p className="muted">Bảng điều khiển cho chủ phòng LIVE</p>
          </div>
        </div>
        {expired && <div className="alert">Phiên đăng nhập đã hết hạn — đăng nhập lại để tiếp tục. Game và overlay vẫn chạy bình thường.</div>}
        <label>
          Mật khẩu quản trị
          <input type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="primary big" disabled={busy || !pw}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
