import { useCallback, useEffect, useState } from 'react';
import type { GameConfig } from '@cau/shared';
import { api, ApiError } from './api';
import { ActionsPage } from './pages/Actions';
import { BlocklistPage } from './pages/Blocklist';
import { DashboardPage } from './pages/Dashboard';
import { FishingPage } from './pages/Fishing';
import { GiftsPage } from './pages/Gifts';
import { HistoryPage } from './pages/History';
import { PlayersPage } from './pages/Players';
import { WorkPage } from './pages/Work';
import { useLive } from './useLive';

type Tab = 'dashboard' | 'actions' | 'gifts' | 'fishing' | 'work' | 'blocklist' | 'history' | 'players';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Điều khiển' },
  { id: 'actions', label: 'Hành động' },
  { id: 'gifts', label: 'Quà tặng' },
  { id: 'fishing', label: 'Câu cá' },
  { id: 'work', label: 'Việc câu' },
  { id: 'blocklist', label: 'Bộ lọc từ' },
  { id: 'history', label: 'Lịch sử' },
  { id: 'players', label: 'Cần thủ' }
];

export type Notify = (msg: string, kind?: 'ok' | 'error') => void;
export type Run = <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);
  const live = useLive(authed === true);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  const reloadConfig = useCallback(() => api.config().then(setConfig), []);
  useEffect(() => {
    if (authed) void reloadConfig();
  }, [authed, reloadConfig]);

  const notify: Notify = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const run: Run = useCallback(
    async (fn, okMsg) => {
      try {
        const r = await fn();
        if (okMsg) notify(okMsg);
        return r;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setAuthed(false);
        notify(err instanceof Error ? err.message : String(err), 'error');
        return undefined;
      }
    },
    [notify]
  );

  if (authed === null) return <div className="center">Đang tải…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="layout">
      <aside>
        <div className="brand">
          🎣 ĐI CÂU
          <br />
          THÔI!
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ws-state">
          <span className={live.connected ? 'dot on' : 'dot'} /> {live.connected ? 'Realtime' : 'Mất kết nối'}
        </div>
        <button className="ghost" onClick={() => run(api.logout).then(() => setAuthed(false))}>
          Đăng xuất
        </button>
      </aside>
      <main>
        {!live.snap || !config ? (
          <div className="center">Đang tải…</div>
        ) : tab === 'dashboard' ? (
          <DashboardPage snap={live.snap} catches={live.catches} config={config} run={run} notify={notify} reloadConfig={reloadConfig} />
        ) : tab === 'actions' ? (
          <ActionsPage config={config} run={run} reloadConfig={reloadConfig} />
        ) : tab === 'gifts' ? (
          <GiftsPage config={config} run={run} reloadConfig={reloadConfig} liveHistory={live.history} />
        ) : tab === 'fishing' ? (
          <FishingPage config={config} run={run} notify={notify} reloadConfig={reloadConfig} />
        ) : tab === 'work' ? (
          <WorkPage config={config} run={run} notify={notify} reloadConfig={reloadConfig} />
        ) : tab === 'blocklist' ? (
          <BlocklistPage config={config} run={run} reloadConfig={reloadConfig} />
        ) : tab === 'history' ? (
          <HistoryPage run={run} live={live.history} />
        ) : (
          <PlayersPage run={run} snap={live.snap} />
        )}
      </main>
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="center">
      <form
        className="card login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            await api.login(pw);
            onDone();
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : 'Lỗi');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>🎣 ĐI CÂU THÔI! — Quản trị</h1>
        <label>
          Mật khẩu
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy || !pw}>
          Đăng nhập
        </button>
      </form>
    </div>
  );
}
