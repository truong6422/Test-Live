import type {
  ActionConfig,
  ActionUpdate,
  BossState,
  CollectiveConfig,
  ConnectorInfo,
  EventOutcome,
  GameConfig,
  GameSnapshot,
  GiftMapping,
  HistoryEntry,
  LeaderboardEntry,
  WorkTask
} from '@sep/shared';

/** followersOnly: server lưu vào action.trigger.followersOnly (có thể chưa có trong schema shared). */
export type ActionPatch = ActionUpdate & { followersOnly?: boolean };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Lỗi ${res.status}`);
  return data as T;
}

export const api = {
  login: (password: string) => call<{ ok: true }>('POST', '/auth/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),
  me: () => call<{ ok: true }>('GET', '/auth/me'),
  state: () => call<GameSnapshot>('GET', '/state'),
  config: () => call<GameConfig>('GET', '/config'),
  startGame: () => call<GameSnapshot>('POST', '/game/start'),
  stopGame: () => call<GameSnapshot>('POST', '/game/stop'),
  resetSession: () => call<{ sessionId: string }>('POST', '/session/reset'),
  connectLive: (username: string) => call<ConnectorInfo>('POST', '/live/connect', { username }),
  disconnectLive: () => call<ConnectorInfo>('POST', '/live/disconnect'),
  demo: (on: boolean) => call<ConnectorInfo>('POST', on ? '/demo/start' : '/demo/stop'),
  updateAction: (id: string, patch: ActionPatch) => call<ActionConfig[]>('PUT', `/actions/${encodeURIComponent(id)}`, patch),
  trigger: (id: string) => call<{ outcome: EventOutcome }>('POST', `/actions/${encodeURIComponent(id)}/trigger`),
  updateGifts: (gifts: GiftMapping[]) => call<GiftMapping[]>('PUT', '/gifts', gifts),
  updateWork: (tasks: WorkTask[]) => call<WorkTask[]>('PUT', '/work', tasks),
  updateCollective: (patch: Partial<CollectiveConfig>) => call<CollectiveConfig>('PUT', '/collective', patch),
  setCalm: (calm: number) => call<BossState>('POST', '/boss', { calm }),
  history: (q: { limit?: number; outcome?: string; session?: 'current' | 'all' }) => {
    const p = new URLSearchParams();
    if (q.limit) p.set('limit', String(q.limit));
    if (q.outcome) p.set('outcome', q.outcome);
    if (q.session) p.set('session', q.session);
    return call<HistoryEntry[]>('GET', `/history?${p}`);
  },
  leaderboard: (scope: 'session' | 'total') => call<LeaderboardEntry[]>('GET', `/leaderboard?scope=${scope}`)
};
