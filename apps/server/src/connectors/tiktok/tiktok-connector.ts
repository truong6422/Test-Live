import { ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent } from 'tiktok-live-connector';
import type { Logger } from '../../logger';
import { parseTikTokUsername, TikTokNormalizer, type TtChat, type TtGift, type TtLike, type TtSocial } from '../../normalizer/tiktok-normalizer';
import type { ConnectorEventListener, ConnectorState, ConnectorStateListener, LiveConnector } from '../types';

/** Phần tối thiểu của TikTokLiveConnection mà adapter dùng — để test bằng bản giả. */
export interface LiveConnectionLike {
  on(event: string, fn: (...args: any[]) => void): unknown;
  removeAllListeners(): unknown;
  connect(): Promise<{ roomId?: string } | unknown>;
  disconnect(): Promise<void>;
}

export type ConnectionFactory = (username: string) => LiveConnectionLike;

export interface TikTokConnectorOptions {
  logger: Logger;
  signApiKey?: string;
  factory?: ConnectionFactory;
  /** Backoff reconnect. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Chờ bao lâu giữa các lần kiểm tra khi kênh chưa phát LIVE. */
  offlineRetryMs?: number;
  random?: () => number;
  now?: () => number;
}

const defaultFactory =
  (signApiKey?: string): ConnectionFactory =>
  (username) =>
    new TikTokLiveConnection(username, {
      // Không xử lý dữ liệu ban đầu: tránh kích hoạt hành động bằng bình luận cũ khi (re)connect.
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
      ...(signApiKey ? { signApiKey } : {})
    }) as unknown as LiveConnectionLike;

/**
 * Adapter TikTok LIVE:
 * - Bọc tiktok-live-connector (thư viện không chính thức) sau interface LiveConnector.
 * - Tự reconnect với exponential backoff + jitter khi mất kết nối; kênh chưa LIVE thì thử lại định kỳ.
 * - Mỗi lần thử tạo connection mới, gỡ listener của connection cũ.
 * - Chỉ đọc sự kiện, không bao giờ gửi gì lên TikTok.
 */
export class TikTokConnector implements LiveConnector {
  readonly name = 'tiktok';
  private readonly log: Logger;
  private readonly factory: ConnectionFactory;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly offlineRetryMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly normalizer = new TikTokNormalizer();

  private conn: LiveConnectionLike | null = null;
  private desired: string | null = null;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private streakTimer: ReturnType<typeof setInterval> | null = null;
  private eventListeners: ConnectorEventListener[] = [];
  private stateListeners: ConnectorStateListener[] = [];
  private st: ConnectorState = {
    status: 'disconnected',
    username: null,
    roomId: null,
    viewerCount: 0,
    lastError: null,
    reconnectAttempt: 0
  };

  constructor(opts: TikTokConnectorOptions) {
    this.log = opts.logger.child('tiktok');
    this.factory = opts.factory ?? defaultFactory(opts.signApiKey);
    this.baseDelayMs = opts.baseDelayMs ?? 2000;
    this.maxDelayMs = opts.maxDelayMs ?? 60_000;
    this.offlineRetryMs = opts.offlineRetryMs ?? 45_000;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
  }

  onEvent(fn: ConnectorEventListener): void {
    this.eventListeners.push(fn);
  }

  onState(fn: ConnectorStateListener): void {
    this.stateListeners.push(fn);
  }

  state(): ConnectorState {
    return { ...this.st };
  }

  /** Kết nối tới kênh. Không ném lỗi khi kênh chưa LIVE — sẽ tự thử lại. Chỉ ném khi username sai. */
  async connect(input: string): Promise<void> {
    const username = parseTikTokUsername(input);
    if (!username) throw new Error('Username TikTok không hợp lệ (ví dụ: @tenkenh hoặc https://www.tiktok.com/@tenkenh/live)');
    await this.disconnect();
    this.desired = username;
    this.setState({ username, reconnectAttempt: 0, lastError: null, roomId: null, viewerCount: 0 });
    this.streakTimer = setInterval(() => this.flushStreaks(), 1000);
    await this.attempt(++this.generation);
  }

  async disconnect(): Promise<void> {
    this.desired = null;
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.streakTimer) clearInterval(this.streakTimer);
    this.reconnectTimer = null;
    this.streakTimer = null;
    this.flushStreaks(true);
    await this.teardown();
    if (this.st.status !== 'disconnected') this.setState({ status: 'disconnected', roomId: null, viewerCount: 0 });
  }

  private async attempt(gen: number): Promise<void> {
    const username = this.desired;
    if (!username || gen !== this.generation) return;
    await this.teardown();
    this.setState({ status: this.st.reconnectAttempt > 0 ? 'reconnecting' : 'connecting' });

    const conn = this.factory(username);
    this.conn = conn;
    this.wire(conn, gen);
    try {
      const res = (await conn.connect()) as { roomId?: string } | undefined;
      if (gen !== this.generation) return;
      this.log.info('Đã kết nối TikTok LIVE', { username, roomId: res?.roomId });
      this.setState({ status: 'connected', roomId: res?.roomId ?? null, lastError: null, reconnectAttempt: 0 });
    } catch (err) {
      if (gen !== this.generation) return;
      const message = err instanceof Error ? err.message : String(err);
      const offline = err instanceof UserOfflineError || /offline|not live|isn't online/i.test(message);
      this.log.warn('Kết nối TikTok thất bại', { username, offline, message });
      this.setState({ status: offline ? 'offline' : 'error', lastError: message });
      this.scheduleReconnect(gen, offline);
    }
  }

  private wire(conn: LiveConnectionLike, gen: number): void {
    const live = () => gen === this.generation;
    const emit = (e: ReturnType<TikTokNormalizer['chat']>) => {
      if (!e || !live()) return;
      for (const fn of this.eventListeners) fn(e);
    };
    const guard =
      <T>(name: string, fn: (d: T) => void) =>
      (d: T) => {
        try {
          fn(d);
        } catch (err) {
          this.log.warn('Lỗi xử lý sự kiện TikTok', { event: name, err });
        }
      };

    conn.on(WebcastEvent.CHAT, guard<TtChat>('chat', (d) => emit(this.normalizer.chat(d, this.now()))));
    conn.on(WebcastEvent.GIFT, guard<TtGift>('gift', (d) => emit(this.normalizer.gift(d, this.now()))));
    conn.on(WebcastEvent.LIKE, guard<TtLike>('like', (d) => emit(this.normalizer.like(d, this.now()))));
    conn.on(WebcastEvent.SHARE, guard<TtSocial>('share', (d) => emit(this.normalizer.social('share', d, this.now()))));
    conn.on(WebcastEvent.FOLLOW, guard<TtSocial>('follow', (d) => emit(this.normalizer.social('follow', d, this.now()))));
    conn.on(
      WebcastEvent.ROOM_USER,
      guard<{ total?: string }>('roomUser', (d) => {
        const n = Number(d?.total ?? 0);
        if (live() && Number.isFinite(n) && n >= 0 && n !== this.st.viewerCount) this.setState({ viewerCount: n });
      })
    );
    conn.on(WebcastEvent.STREAM_END, () => {
      if (!live()) return;
      this.log.info('Chủ kênh đã kết thúc LIVE');
      this.setState({ status: 'offline', lastError: 'LIVE đã kết thúc', roomId: null });
      this.scheduleReconnect(gen, true);
    });
    conn.on(ControlEvent.DISCONNECTED, () => {
      if (!live() || this.st.status === 'offline') return;
      this.log.warn('Mất kết nối TikTok, sẽ kết nối lại');
      this.setState({ status: 'reconnecting', roomId: null });
      this.scheduleReconnect(gen, false);
    });
    conn.on(ControlEvent.ERROR, (err: unknown) => {
      if (!live()) return;
      const info = (err as { info?: string; exception?: Error })?.info ?? String(err);
      this.log.warn('TikTok connector báo lỗi', { info, err: (err as { exception?: Error })?.exception });
    });
  }

  private scheduleReconnect(gen: number, offline: boolean): void {
    if (!this.desired || gen !== this.generation) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const attempt = this.st.reconnectAttempt + 1;
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
    const base = offline ? Math.max(this.offlineRetryMs, exp) : exp;
    const delay = Math.round(base * (0.8 + this.random() * 0.4));
    this.setState({ reconnectAttempt: attempt });
    this.log.info('Hẹn kết nối lại', { attempt, delayMs: delay, offline });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attempt(gen);
    }, delay);
  }

  private async teardown(): Promise<void> {
    const c = this.conn;
    this.conn = null;
    if (!c) return;
    c.removeAllListeners();
    // Gỡ listener trước rồi mới ngắt để DISCONNECTED của connection cũ không kích hoạt reconnect.
    c.on('error', () => {});
    await c.disconnect().catch(() => {});
  }

  private flushStreaks(all = false): void {
    const now = all ? Number.MAX_SAFE_INTEGER : this.now();
    for (const e of this.normalizer.flushStale(now)) {
      for (const fn of this.eventListeners) fn(e);
    }
  }

  private setState(patch: Partial<ConnectorState>): void {
    this.st = { ...this.st, ...patch };
    for (const fn of this.stateListeners) fn(this.state());
  }
}
