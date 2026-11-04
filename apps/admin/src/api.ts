import type {
  ActionConfig,
  ActionUpdate,
  FishingConfig,
  CollectiveConfig,
  ConnectorInfo,
  EventOutcome,
  GameConfig,
  GameSnapshot,
  GiftMapping,
  HistoryEntry,
  LakeState,
  LeaderboardEntry,
  SessionStats,
  WorkTask
} from '@cau/shared';

/** Bản vá gửi lên PUT /api/actions/:id (khớp actionUpdateSchema). */
export type ActionPatch = ActionUpdate;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Gọi khi server trả 401 (phiên đăng nhập hết hạn — cookie sống 12 giờ). App đăng ký để quay về màn đăng nhập,
 * kể cả với các lần hỏi định kỳ (hồ câu, thống kê) vốn nuốt lỗi.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body)
    });
  } catch {
    // Mất mạng / server tắt: fetch ném TypeError tiếng Anh ("Failed to fetch") → đổi sang câu dễ hiểu.
    throw new ApiError(0, 'Không kết nối được server game — kiểm tra server còn chạy không');
  }
  const data = await res.json().catch(() => ({}));
  // /auth/login trả 401 khi sai mật khẩu — đó không phải "hết phiên".
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onUnauthorized?.();
  if (!res.ok) {
    if (res.status === 409 && path === '/demo/start') throw new ApiError(409, 'Ngắt kết nối TikTok trước khi thử demo');
    const msg = (data as { error?: string }).error;
    // Lỗi 5xx: server chỉ trả "Lỗi máy chủ" (hoặc proxy trả HTML) → câu chung, dễ hiểu.
    if (res.status === 502 || res.status === 503 || res.status === 504)
      throw new ApiError(res.status, 'Không kết nối được server game — kiểm tra server còn chạy không');
    if (res.status >= 500) throw new ApiError(res.status, 'Lỗi máy chủ — thử lại sau giây lát. Nếu lặp lại, xem log của server game.');
    throw new ApiError(res.status, msg ?? `Lỗi ${res.status}`);
  }
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
  /** profile 'live' = giả lập giống phiên LIVE nhỏ thật; 'busy' = dồn dập để thử mọi hoạt ảnh. */
  demo: (on: boolean, profile: 'busy' | 'live' = 'busy') =>
    call<ConnectorInfo>('POST', on ? '/demo/start' : '/demo/stop', on ? { profile } : undefined),
  updateAction: (id: string, patch: ActionPatch) => call<ActionConfig[]>('PUT', `/actions/${encodeURIComponent(id)}`, patch),
  trigger: (id: string) => call<{ outcome: EventOutcome }>('POST', `/actions/${encodeURIComponent(id)}/trigger`),
  updateGifts: (gifts: GiftMapping[]) => call<GiftMapping[]>('PUT', '/gifts', gifts),
  updateWork: (tasks: WorkTask[]) => call<WorkTask[]>('PUT', '/work', tasks),
  updateFishing: (patch: Partial<FishingConfig>) => call<FishingConfig>('PUT', '/fishing', patch),
  updateCollective: (patch: Partial<CollectiveConfig>) => call<CollectiveConfig>('PUT', '/collective', patch),
  history: (q: { limit?: number; outcome?: string; session?: 'current' | 'all' }) => {
    const p = new URLSearchParams();
    if (q.limit) p.set('limit', String(q.limit));
    if (q.outcome) p.set('outcome', q.outcome);
    if (q.session) p.set('session', q.session);
    return call<HistoryEntry[]>('GET', `/history?${p}`);
  },
  leaderboard: (scope: 'session' | 'total') => call<LeaderboardEntry[]>('GET', `/leaderboard?scope=${scope}`),
  /** Đường dẫn overlay có OVERLAY_KEY (chỉ admin đã đăng nhập mới lấy được). */
  overlayUrl: () => call<{ path: string }>('GET', '/overlay-url'),
  lake: () => call<LakeState>('GET', '/lake'),
  kick: (platformId: string) => call<LakeState>('POST', '/lake/kick', { platformId }),
  bigFishNow: () => call<{ result: 'started' | 'postponed'; nextBigFishAt: number }>('POST', '/bigfish/now'),
  stats: () => call<SessionStats>('GET', '/stats'),
  blocklist: () => call<string[]>('GET', '/blocklist'),
  updateBlocklist: (words: string[]) => call<string[]>('PUT', '/blocklist', words),
  testBlocklist: (text: string, words?: string[]) =>
    call<{ comment: string; displayName: string }>('POST', '/blocklist/test', { text, words })
};
