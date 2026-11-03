import type {
  ActionUpdate,
  CollectiveConfig,
  ConnectorInfo,
  FishingConfig,
  GameConfig,
  GiftMapping,
  HistoryEntry,
  ServerMessage,
  WorkTask
} from '@cau/shared';
import { DemoConnector } from './connectors/demo/demo-connector';
import type { ConnectorState, LiveConnector } from './connectors/types';
import type { Clock } from './engine/clock';
import { GameEngine } from './engine/engine';
import type { Logger } from './logger';
import { cleanComment, cleanDisplayName, normalizeBlocklist, setBlocklist, toBlockSet } from './normalizer/sanitize';
import { computeTitle } from './players/players';
import type { GameStore, HistoryQuery } from './store/store';

/** Phần điều khiển TikTok mà service cần (cài đặt thật ở connectors/tiktok). */
export interface TikTokControl extends LiveConnector {
  connect(username: string): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ServiceDeps {
  store: GameStore;
  clock: Clock;
  logger: Logger;
  defaults: GameConfig;
  tiktok: TikTokControl;
  demo?: DemoConnector;
  historyRetentionDays: number;
  newId?: () => string;
}

const HISTORY_BUFFER_MAX = 5000;
/** Trạng thái TikTok coi như đang LIVE thật — không được bật demo. */
const LIVE_STATUSES: ReadonlySet<ConnectorState['status']> = new Set(['connected', 'connecting', 'reconnecting']);

/**
 * Nối Game Engine với lưu trữ, connector và client. Mọi thao tác admin đi qua đây.
 */
export class GameService {
  readonly engine: GameEngine;
  private readonly store: GameStore;
  private readonly log: Logger;
  private readonly tiktok: TikTokControl;
  private readonly demo: DemoConnector;
  private readonly newId: () => string;
  private config!: GameConfig;
  private historyBuffer: HistoryEntry[] = [];
  private collectiveDirty = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private listeners = new Set<(m: ServerMessage) => void>();
  private flushing = false;

  private constructor(private deps: ServiceDeps, config: GameConfig) {
    this.store = deps.store;
    this.log = deps.logger.child('service');
    this.tiktok = deps.tiktok;
    this.demo = deps.demo ?? new DemoConnector();
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.config = config;
    setBlocklist(config.blocklist ?? []);
    this.engine = new GameEngine({ clock: deps.clock, config, newId: this.newId });

    this.engine.subscribe((msg) => {
      if (msg.type === 'history') {
        this.historyBuffer.push(msg.data);
        if (this.historyBuffer.length > HISTORY_BUFFER_MAX) {
          this.historyBuffer.splice(0, this.historyBuffer.length - HISTORY_BUFFER_MAX);
          this.log.warn('Bộ đệm lịch sử đầy, bỏ bớt bản ghi cũ (DB chậm hoặc mất kết nối?)');
        }
      }
      if (msg.type === 'collective') this.collectiveDirty = true;
      for (const fn of this.listeners) fn(msg);
    });

    const ingest = (source: string) => (e: Parameters<GameEngine['ingest']>[0]) => {
      const outcome = this.engine.ingest(e);
      this.log.debug('event', { source, kind: e.kind, id: e.id, outcome });
    };
    this.tiktok.onEvent(ingest('tiktok'));
    this.demo.onEvent(ingest('demo'));
    this.tiktok.onState(() => this.pushConnectors());
  }

  static async create(deps: ServiceDeps): Promise<GameService> {
    await deps.store.init(deps.defaults);
    const config = await deps.store.loadConfig();
    const svc = new GameService(deps, config);
    svc.engine.loadPlayers(await deps.store.loadPlayers());
    return svc;
  }

  subscribe(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Bắt đầu vòng tick và lưu dữ liệu định kỳ. */
  startLoops(): void {
    this.timers.push(setInterval(() => this.engine.tick(), 100));
    this.timers.push(setInterval(() => void this.flush(), 2000));
    this.timers.push(
      setInterval(() => {
        const cutoff = new Date(Date.now() - this.deps.historyRetentionDays * 86_400_000);
        this.store
          .pruneHistory(cutoff)
          .then((n) => n > 0 && this.log.info('Đã dọn lịch sử cũ', { removed: n }))
          .catch((err) => this.log.warn('Dọn lịch sử lỗi', { err }));
      }, 3600_000)
    );
  }

  async shutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.demo.stop();
    await this.tiktok.disconnect().catch(() => {});
    await this.flush();
    await this.store.close();
  }

  /** Ghi lịch sử, cần thủ và sự kiện tập thể xuống DB theo lô. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    const sessionId = this.engine.currentSessionId;
    const history = this.historyBuffer.splice(0);
    const players = this.engine.players.takeDirty().map(({ player, session }) => ({
      player: { ...player, title: computeTitle(player) },
      session
    }));
    try {
      await this.store.appendHistory(history);
      await this.store.savePlayers(sessionId, players);
      const c = this.engine.snapshot().collective;
      if (this.collectiveDirty && c) {
        this.collectiveDirty = false;
        await this.store.saveCollective(sessionId, c, this.config.collective.rewardTitle);
      }
    } catch (err) {
      // Trả lại bộ đệm để lần sau ghi lại; game vẫn chạy bình thường.
      this.historyBuffer.unshift(...history);
      this.engine.players.markDirty(players.map((p) => p.player.platformId));
      this.log.error('Lưu DB lỗi, sẽ thử lại', { err });
    } finally {
      this.flushing = false;
    }
  }

  // --------------------------------------------------------------------------
  // Game & phiên
  // --------------------------------------------------------------------------
  async startGame(): Promise<void> {
    let sessionId = this.engine.currentSessionId ?? (await this.store.openSession());
    if (!sessionId) {
      sessionId = this.newId();
      await this.store.startSession(sessionId, this.tiktok.state().username);
    }
    this.engine.start(sessionId);
    this.log.info('Game bắt đầu', { sessionId });
  }

  stopGame(): void {
    this.engine.stop();
    this.log.info('Game dừng');
  }

  async resetSession(): Promise<string> {
    await this.flush();
    const old = this.engine.currentSessionId;
    if (old) await this.store.endSession(old);
    const id = this.newId();
    await this.store.startSession(id, this.tiktok.state().username);
    this.engine.resetSession(id);
    this.log.info('Reset phiên LIVE', { old, new: id });
    return id;
  }

  // --------------------------------------------------------------------------
  // Cấu hình
  // --------------------------------------------------------------------------
  getConfig(): GameConfig {
    return structuredClone(this.config);
  }

  async updateAction(id: string, patch: ActionUpdate): Promise<void> {
    const cfg = this.getConfig();
    const a = cfg.actions.find((x) => x.id === id);
    if (!a) throw new NotFoundError(`Không có hành động ${id}`);
    if (patch.name !== undefined) a.name = patch.name;
    if (patch.enabled !== undefined) a.enabled = patch.enabled;
    if (patch.keywords !== undefined) a.trigger.keywords = patch.keywords;
    if (patch.triggerKinds !== undefined) a.trigger.kinds = patch.triggerKinds;
    if (patch.durationMs !== undefined) a.durationMs = patch.durationMs;
    if (patch.cooldownMs !== undefined) a.cooldownMs = patch.cooldownMs;
    if (patch.userCooldownMs !== undefined) a.userCooldownMs = patch.userCooldownMs;
    if (patch.priority !== undefined) a.priority = patch.priority;
    if (patch.points !== undefined) a.points = patch.points;
    if (patch.kingCalm !== undefined) a.kingEffect.calm = patch.kingCalm;
    if (patch.kingStamina !== undefined) a.kingEffect.stamina = patch.kingStamina;
    if (patch.fish === null) delete a.fish;
    else if (patch.fish !== undefined) a.fish = patch.fish;
    if (patch.followersOnly !== undefined) a.trigger.followersOnly = patch.followersOnly;
    await this.applyConfig(cfg);
  }

  async updateWork(tasks: WorkTask[]): Promise<void> {
    const seen = new Set<string>();
    for (const t of tasks) {
      if (seen.has(t.id)) throw new ValidationError(`Trùng mã công việc: ${t.id}`);
      seen.add(t.id);
    }
    const cfg = this.getConfig();
    cfg.work = tasks;
    await this.applyConfig(cfg);
  }

  async updateGifts(gifts: GiftMapping[]): Promise<void> {
    const cfg = this.getConfig();
    const ids = new Set(cfg.actions.map((a) => a.id));
    const bad = gifts.find((g) => !ids.has(g.actionId));
    if (bad) throw new ValidationError(`Hành động không tồn tại: ${bad.actionId}`);
    cfg.gifts = gifts;
    await this.applyConfig(cfg);
  }

  async updateFishing(patch: Partial<FishingConfig>): Promise<void> {
    const cfg = this.getConfig();
    const next = { ...cfg.fishing, ...patch };
    if (!cfg.actions.some((a) => a.id === next.bigFishActionId)) {
      throw new ValidationError(`Hành động không tồn tại: ${next.bigFishActionId}`);
    }
    const bad = next.loot.find((l) => l.minKg > l.maxKg);
    if (bad) throw new ValidationError(`Cân tối thiểu lớn hơn tối đa: ${bad.name}`);
    if (!next.loot.some((l) => l.weight > 0)) throw new ValidationError('Bảng cá cần ít nhất một loại có trọng số > 0');
    cfg.fishing = next;
    await this.applyConfig(cfg);
  }

  async updateCollective(patch: Partial<CollectiveConfig>): Promise<void> {
    const cfg = this.getConfig();
    cfg.collective = { ...cfg.collective, ...patch };
    await this.applyConfig(cfg);
  }

  /** Lưu bộ lọc từ (đã chuẩn hoá: chữ thường, NFC, bỏ trùng). Áp dụng ngay cho bình luận / tên mới. */
  async updateBlocklist(words: string[]): Promise<string[]> {
    const cfg = this.getConfig();
    cfg.blocklist = normalizeBlocklist(words);
    await this.applyConfig(cfg);
    return cfg.blocklist;
  }

  /** Thử bộ lọc: kết quả hiển thị nếu `text` là bình luận / tên người xem (mặc định dùng danh sách đang lưu). */
  testBlocklist(text: string, words?: string[]): { comment: string; displayName: string } {
    const set = toBlockSet(words ?? this.config.blocklist ?? []);
    return { comment: cleanComment(text, set), displayName: cleanDisplayName(text, '(trống)', set) };
  }

  private async applyConfig(cfg: GameConfig): Promise<void> {
    await this.store.saveConfig(cfg);
    this.config = cfg;
    setBlocklist(cfg.blocklist ?? []);
    this.engine.updateConfig(cfg);
  }

  // --------------------------------------------------------------------------
  // Hồ câu
  // --------------------------------------------------------------------------
  /** Mời một người rời hồ (NotFoundError nếu người đó không đang ngồi). */
  kickFromLake(platformId: string): void {
    if (!this.engine.kick(platformId)) throw new NotFoundError('Người này không đang ngồi trong hồ');
    this.log.info('Admin mời rời hồ', { platformId });
  }

  /** Cá to định kỳ xuất hiện ngay. Trả về 'started' hoặc 'postponed' (đang kéo cá quà, chạy ngay sau). */
  bigFishNow(): 'started' | 'postponed' {
    const r = this.engine.triggerBigFishNow();
    if (r === 'not_running') throw new ConflictError('Game đang dừng — bấm "Bắt đầu game" trước');
    if (r === 'empty') throw new ConflictError('Hồ chưa có ai ngồi câu');
    if (r === 'disabled') throw new ConflictError('Hành động cá to định kỳ đang tắt hoặc không tồn tại (xem tab Câu cá)');
    return r;
  }

  // --------------------------------------------------------------------------
  // Kết nối
  // --------------------------------------------------------------------------
  /** Kết nối TikTok LIVE thật. Đang chạy demo thì tắt demo trước (không trộn sự kiện giả với LIVE thật). */
  async connectTikTok(username: string): Promise<void> {
    if (this.demo.running) {
      this.demo.stop();
      this.log.info('Tắt demo trước khi kết nối TikTok');
      this.pushConnectors();
    }
    await this.tiktok.connect(username);
  }

  async disconnectTikTok(): Promise<void> {
    await this.tiktok.disconnect();
  }

  /** Bật/tắt demo. Không cho bật khi đang kết nối / đã kết nối TikTok LIVE thật (ConflictError → HTTP 409). */
  setDemo(running: boolean): void {
    if (running && LIVE_STATUSES.has(this.tiktok.state().status)) {
      throw new ConflictError('Đang kết nối TikTok LIVE thật — ngắt kết nối TikTok trước khi bật chế độ demo');
    }
    if (running) this.demo.start();
    else this.demo.stop();
    this.pushConnectors();
  }

  connectorInfo(): ConnectorInfo {
    const t: ConnectorState = this.tiktok.state();
    return { tiktok: { ...t }, demo: { running: this.demo.running } };
  }

  private pushConnectors(): void {
    this.engine.setConnectors(this.connectorInfo());
  }

  // --------------------------------------------------------------------------
  // Truy vấn
  // --------------------------------------------------------------------------
  listHistory(q: HistoryQuery): Promise<HistoryEntry[]> {
    return this.store.listHistory(q);
  }

  async health(): Promise<{ ok: boolean; db: boolean; tiktok: string; demo: boolean }> {
    const db = await this.store.ping();
    return { ok: db, db, tiktok: this.tiktok.state().status, demo: this.demo.running };
  }
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
export class ConflictError extends Error {}
