import type {
  ActionConfig,
  CatchEvent,
  ConnectorInfo,
  EventKind,
  EventOutcome,
  EventSource,
  FeedItem,
  FishingConfig,
  GameConfig,
  GameSnapshot,
  HistoryEntry,
  KingState,
  LiveUser,
  NormalizedEvent,
  LakeState,
  RosterMember,
  RunningAction,
  ServerMessage,
  SessionStats,
  WorkTask
} from '@cau/shared';
import { DEFAULT_MAX_CATCHES_PER_TICK, DEFAULT_TARGET_CATCH_MS } from '../config/defaults';
import { applyEffect, initialKing, kingChangedMeaningfully, recover, setCalm } from './king';
import type { Clock } from './clock';
import { CollectiveTracker } from './collective';
import { CooldownTracker } from './cooldown';
import { Deduper } from './dedupe';
import { fillCatchText, fixedBigFish, formatKg, gramsToKg, kgToGrams, pickLoot, rollBigFish, type Catch, type Random } from './loot';
import { giftValue, matchAction, matchWork } from './matcher';
import { ActionQueue, type QueueItem } from './queue';
import { RateLimiter } from './rate-limit';
import { AnimationScheduler } from './scheduler';
import { isDemoPlayer, PlayerRegistry, type PlayerRecord, type SessionStat } from '../players/players';

type ActorSource = EventSource | 'collective';

interface QueuedPayload {
  eventId: string;
  source: ActorSource;
  user: LiveUser | null;
  detail: string;
  /** Cá to đã chốt cân lúc nhận (đã cộng cho người được hưởng). */
  fish?: Catch;
}

export type EngineListener = (msg: ServerMessage) => void;

export interface EngineOptions {
  clock: Clock;
  config: GameConfig;
  newId?: () => string;
  /** Nguồn ngẫu nhiên [0, 1) cho bốc cá / cân cá / chọn người cá to (tiêm vào để test). */
  random?: Random;
  /** Giới hạn tần suất phát leaderboard/feed ra client. */
  broadcastIntervalMs?: number;
}

/** Điểm cơ bản cho mỗi lượt tham gia (chưa tính điểm của hành động). */
const BASE_POINTS: Record<Exclude<EventKind, 'join'>, number> = {
  comment: 1,
  like: 1,
  share: 2,
  follow: 2,
  gift: 0
};

/** Điểm cho mỗi con cá câu tự động (cộng thêm `loot.points`). Rác không được điểm cơ bản. */
export const CATCH_BASE_POINTS = 1;

const FEED_MAX = 30;
/** Hành động chạy nối tiếp: cái trước kết thúc mới bắt đầu cái sau, bất kể limits.maxConcurrent đã lưu. */
export const MAX_CONCURRENT_ACTIONS = 1;

/** Khoảng cách tối thiểu giữa hai lần nhắc follow cho cùng một người. */
const FOLLOW_HINT_MS = 60_000;
export const FOLLOW_HINT_TEXT = 'Người theo dõi kênh được đội nón lá 👒';

/** Tên hiển thị khi người kích hoạt là cả hồ (sự kiện tập thể). */
const CROWD_NAME = 'Cả hồ';
/** Cá to định kỳ bị hoãn vì đang kéo cá quà: chờ thêm chừng này sau khi hàng đợi dự kiến trống. */
export const BIG_FISH_POSTPONE_GAP_MS = 1000;
/** Cá to định kỳ bị hoãn vì quà tối đa chừng này; quá hạn thì chạy ngay sau hoạt ảnh đang chạy. */
export const BIG_FISH_MAX_POSTPONE_MS = 60_000;
/** Ưu tiên của cá to định kỳ đã quá hạn hoãn (trên mọi hành động khác trong hàng đợi). */
const BIG_FISH_OVERDUE_PRIORITY = 100_000;
/** Admin mời rời hồ: trong chừng này người đó không tự vào lại bằng bình luận (tặng quà vẫn vào). */
export const KICK_REJOIN_BLOCK_MS = 10 * 60_000;

/** Kết quả admin bấm "Cá to ngay". */
export type BigFishNowResult = 'started' | 'postponed' | 'not_running' | 'empty' | 'disabled';

interface StatsCounter {
  activeMs: number;
  fishCaught: number;
  junkCaught: number;
  bigFishPulled: number;
  totalGrams: number;
  giftsReceived: number;
  giftDiamonds: number;
  biggest: SessionStats['biggest'];
}

const emptyStats = (): StatsCounter => ({
  activeMs: 0,
  fishCaught: 0,
  junkCaught: 0,
  bigFishPulled: 0,
  totalGrams: 0,
  giftsReceived: 0,
  giftDiamonds: 0,
  biggest: null
});

/**
 * GAME ENGINE — luồng xử lý:
 *  1 nhận NormalizedEvent → 2 kiểm tra game đang chạy → 3 chống trùng → 4 giới hạn tần suất
 *  → 5 ghi nhận cần thủ + điểm + vào hồ (bình luận / quà) + sự kiện tập thể → 6 ánh xạ hành động (quà → kéo cá to)
 *  → 7 bật/tắt, cooldown → 8 chốt cân cá to + đưa vào hàng đợi ưu tiên → 9 scheduler khởi chạy, cập nhật Cá Thần
 *  → 10 phát qua listener + lịch sử.
 * Song song: mỗi `fishing.tickMs` có `catchesPerTick` con cá cắn câu lần lượt theo thứ tự vào hồ ('catches');
 * định kỳ có cá to xuất hiện (bóng cá báo trước `bigFishShadowMs`, chọn đều một người đang ngồi).
 *
 * Engine không làm I/O: thời gian lấy từ `clock`, kết quả đi qua listener. Host gọi tick() định kỳ.
 */
export class GameEngine {
  private config: GameConfig;
  private readonly clock: Clock;
  private readonly newId: () => string;
  private readonly random: Random;
  private readonly broadcastIntervalMs: number;

  private running = false;
  private sessionId: string | null = null;

  private king: KingState = initialKing();
  private lastBroadcastKing: KingState = initialKing();
  private queue: ActionQueue<QueuedPayload>;
  private scheduler: AnimationScheduler;
  private cooldowns = new CooldownTracker();
  private deduper = new Deduper();
  private limiter: RateLimiter;
  readonly players = new PlayerRegistry();
  private collective: CollectiveTracker;
  private feed: FeedItem[] = [];
  /** Lần cuối nhắc follow theo người. */
  private hintAt = new Map<string, number>();
  /** Mốc chu kỳ câu tự động gần nhất. */
  private lastFishingAt = 0;
  /** Mốc cá to định kỳ kế tiếp (0 = tắt / chưa hẹn). */
  private nextBigFishAt = 0;
  /** Tick đầu tiên thấy cá to đến hạn (0 = chưa). Cá to chỉ ra ở tick sau đó nếu không có quà chen vào. */
  private bigFishArmedAt = 0;
  /** Lần đầu cá to định kỳ hiện tại bị hoãn vì quà (0 = chưa hoãn). */
  private bigFishPostponedSince = 0;
  /** Người trúng cá to định kỳ lần trước (không trúng hai lần liền khi hồ ≥ 2 người). */
  private lastBigFishWinner: string | null = null;
  /** TikTok báo LIVE đã kết thúc / kênh offline: tạm dừng câu tự động, cá to, tập thể (tới khi kết nối lại). */
  private streamOffline = false;
  private offlineSince = 0;
  /** Mốc sự kiện LIVE hợp lệ gần nhất (sau chống trùng / giới hạn tần suất). */
  private lastEventAt = 0;

  private listeners = new Set<EngineListener>();
  /** Thống kê phiên (chỉ trong bộ nhớ). */
  private stats: StatsCounter = emptyStats();
  private lastTickAt: number;
  private leaderboardDirty = false;
  private feedDirty = false;
  /** Tiến trình sự kiện tập thể đổi, chờ flush phát (gom nhiều bình luận vào một tin). */
  private collectiveMsgDirty = false;
  /** Danh sách Bến Vàng của lần phát roster gần nhất (null = chưa phát / buộc phát lại). */
  private lastFrontKey: string | null = null;
  private lastFlushAt = 0;
  private connectors: ConnectorInfo = {
    tiktok: { status: 'disconnected', username: null, roomId: null, viewerCount: 0, lastError: null, reconnectAttempt: 0 },
    demo: { running: false }
  };

  constructor(opts: EngineOptions) {
    this.clock = opts.clock;
    this.config = serialized(opts.config);
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.random = opts.random ?? Math.random;
    this.broadcastIntervalMs = opts.broadcastIntervalMs ?? 250;
    const now = this.clock.now();
    this.lastTickAt = now;
    this.lastFishingAt = now;
    this.queue = new ActionQueue(this.config.limits.maxQueue);
    this.scheduler = new AnimationScheduler(MAX_CONCURRENT_ACTIONS);
    this.limiter = this.makeLimiter(now);
    this.collective = new CollectiveTracker(this.config.collective, this.newId);
    this.players.frontSeats = this.config.fishing.frontSeats;
  }

  // --------------------------------------------------------------------------
  // Đăng ký nhận cập nhật
  // --------------------------------------------------------------------------
  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(msg: ServerMessage): void {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {
        // listener lỗi không được làm hỏng engine
      }
    }
  }

  // --------------------------------------------------------------------------
  // Vòng đời game / phiên
  // --------------------------------------------------------------------------
  start(sessionId: string): void {
    const now = this.clock.now();
    this.running = true;
    this.sessionId = sessionId;
    this.lastFishingAt = now;
    if (!this.collective.current) this.collective.start(now);
    // Chưa hẹn, hoặc đã quá hạn trong lúc game dừng → hẹn lại một chu kỳ đủ (không bật cá to ngay khi vừa bấm chạy).
    if (this.nextBigFishAt === 0 || this.nextBigFishAt <= now) this.scheduleBigFish(now);
    this.emit({ type: 'game', data: { running: true, sessionId, streamOffline: this.streamOffline } });
    this.emit({ type: 'collective', data: this.collective.current });
  }

  stop(): void {
    this.running = false;
    this.bigFishArmedAt = 0;
    this.queue.clear();
    this.emit({ type: 'game', data: { running: false, sessionId: this.sessionId, streamOffline: this.streamOffline } });
    this.emit({ type: 'queue', data: { length: 0 } });
  }

  /** Bắt đầu phiên LIVE mới: xoá thống kê phiên, người ngồi câu, hàng đợi, hoạt ảnh, Cá Thần, sự kiện tập thể. */
  resetSession(newSessionId: string): void {
    const now = this.clock.now();
    for (const r of this.scheduler.clear()) this.emit({ type: 'action.ended', data: { runId: r.runId, actionId: r.actionId } });
    this.queue.clear();
    this.cooldowns.reset();
    this.hintAt.clear();
    this.players.resetSession();
    this.stats = emptyStats();
    this.king = initialKing();
    this.lastBroadcastKing = this.king;
    this.feed = [];
    this.lastFrontKey = null;
    this.collectiveMsgDirty = false;
    this.collective.reset(now);
    this.sessionId = newSessionId;
    this.lastFishingAt = now;
    this.scheduleBigFish(now);
    this.emit({ type: 'snapshot', data: this.snapshot() });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Game đang chạy VÀ LIVE đang phát: câu tự động / cá to / tập thể hoạt động. */
  private get active(): boolean {
    return this.running && !this.streamOffline;
  }

  get isStreamOffline(): boolean {
    return this.streamOffline;
  }

  /**
   * Host báo trạng thái LIVE: kết thúc / offline → tạm dừng câu tự động, cá to định kỳ, tập thể (quà không tới được);
   * kết nối lại → chạy tiếp: hẹn lại cá to nếu đã quá hạn, làm mới mốc hoạt động để không mời rời hồ oan.
   */
  setStreamOnline(online: boolean): void {
    const offline = !online;
    if (offline === this.streamOffline) return;
    this.streamOffline = offline;
    const now = this.clock.now();
    if (online) {
      this.lastFishingAt = now;
      this.players.refreshSeen(now);
      // Đồng hồ cá to "đóng băng" trong lúc offline: dời mốc đúng bằng thời gian đã tạm dừng.
      if (this.nextBigFishAt > 0) {
        this.nextBigFishAt += Math.max(0, now - this.offlineSince);
        this.emit({ type: 'bigfish.next', data: { at: this.nextBigFishAt, shadowMs: this.config.fishing.bigFishShadowMs } });
      }
    } else {
      this.offlineSince = now;
      this.bigFishArmedAt = 0;
    }
    this.emit({ type: 'game', data: { running: this.running, sessionId: this.sessionId, streamOffline: offline } });
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  // --------------------------------------------------------------------------
  // Cấu hình
  // --------------------------------------------------------------------------
  getConfig(): GameConfig {
    return structuredClone(this.config);
  }

  updateConfig(cfg: GameConfig): void {
    const now = this.clock.now();
    const next = serialized(cfg);
    const limitsChanged = JSON.stringify(next.limits) !== JSON.stringify(this.config.limits);
    const bigFishChanged = next.fishing.bigFishEveryMs !== this.config.fishing.bigFishEveryMs;
    const seatsChanged = next.fishing.frontSeats !== this.config.fishing.frontSeats;
    const prevShadow = this.config.fishing.bigFishShadowMs;
    this.config = next;
    this.queue.setMaxSize(cfg.limits.maxQueue);
    if (limitsChanged) this.limiter = this.makeLimiter(now);
    this.players.frontSeats = next.fishing.frontSeats;
    if (seatsChanged) this.leaderboardDirty = true;
    if (bigFishChanged) this.scheduleBigFish(now);
    else if (next.fishing.bigFishShadowMs !== prevShadow) {
      this.emit({ type: 'bigfish.next', data: { at: this.nextBigFishAt, shadowMs: next.fishing.bigFishShadowMs } });
    }
    this.collective.setConfig(cfg.collective, now);
    this.emit({ type: 'collective', data: this.collective.current });
  }

  setConnectors(info: ConnectorInfo): void {
    this.connectors = info;
    this.emit({ type: 'connectors', data: info });
  }

  setKingCalm(calm: number): void {
    this.king = setCalm(this.king, calm, this.clock.now());
    this.broadcastKing(true);
  }

  // --------------------------------------------------------------------------
  // Nhận sự kiện
  // --------------------------------------------------------------------------
  ingest(event: NormalizedEvent): EventOutcome {
    const now = this.clock.now();

    if (event.kind === 'join') return 'filtered';

    // Game DỪNG chỉ dừng câu tự động, cá to định kỳ và sự kiện tập thể. Quà vẫn được xử lý đầy đủ (người xem đã
    // bỏ tiền — không bao giờ bỏ quà); bình luận vẫn đưa người vào hồ, tim/share/follow vẫn làm mới thời gian
    // hoạt động — nhưng không kích hoạt việc vui / hành động (trả về 'game_stopped').
    if (this.deduper.isDuplicate(event.id, now)) {
      this.record(event, 'deduped', null, 'Sự kiện trùng');
      return 'deduped';
    }

    // Quà không bao giờ bị giới hạn tần suất: người xem đã bỏ tiền, TikTok đã tự giới hạn, và thả tim dồn dập
    // (cùng bucket) không được làm mất quà. Bình luận / tim / share / follow vẫn qua bucket.
    if (event.kind !== 'gift' && !this.limiter.allow(event.user.platformId, now)) {
      this.record(event, 'rate_limited', null, 'Vượt giới hạn tần suất');
      return 'rate_limited';
    }

    this.lastEventAt = now;
    // Mọi lượt tham gia hợp lệ đều được ghi nhận, kể cả không khớp hành động nào.
    const diamonds = event.kind === 'gift' && event.gift ? giftValue(event.gift) : 0;
    const basePoints = event.kind === 'gift' ? diamonds : BASE_POINTS[event.kind];
    const player = this.players.participate(event.user, basePoints);
    if (event.kind === 'follow') this.players.markFollower(event.user.platformId);
    // Bình luận / tặng quà bất kỳ → vào hồ ngồi câu.
    // Người vừa bị admin mời rời hồ không vào lại (kể cả bằng quà) cho tới hết KICK_REJOIN_BLOCK_MS, và tên họ
    // không hiện trên overlay (không bong bóng chat, không việc vui, không hoạt ảnh/feed). Quà vẫn được ghi nhận.
    const kicked = this.players.isKicked(player.platformId, now);
    if (!kicked && (event.kind === 'comment' || event.kind === 'gift')) this.players.join(player.platformId, now);
    // Tim / share / follow của người ĐANG ngồi làm mới thời gian hoạt động (không đưa người mới vào hồ).
    else if (!kicked) this.players.touch(player.platformId, now);
    // TOP QUÀ TẶNG tính theo kim cương đã tặng.
    if (diamonds > 0) this.players.addDiamonds(event.user.platformId, diamonds);
    if (event.kind === 'gift') {
      this.stats.giftsReceived += 1;
      this.stats.giftDiamonds += diamonds;
    }
    this.leaderboardDirty = true;
    // Quà làm đổi thứ hạng kim cương → nếu Bến Vàng đổi thì phát roster NGAY (lên Bến Vàng tức thì, không chờ tick);
    // còn lại để flush gom (tránh phát cả roster cho từng món quà khi LIVE đông).
    if (event.kind === 'gift') this.emitRosterIfFrontChanged();
    const match = matchAction(event, this.config.actions, this.config.gifts);
    // Người bị mời rời hồ: không góp sức tập thể, không nhận phần chia Cá Thần, không hiện trên overlay.
    if (kicked) return this.ingestKicked(event, player, match?.action ?? null, now);

    // Sự kiện tập thể chỉ tính tương tác MIỄN PHÍ (bình luận / share / follow): phần thưởng Cá Thần có cân ngẫu nhiên,
    // nên quà không được góp vào (chính sách TikTok: quà không gắn với kết quả may rủi). Thả tim không tính.
    // Game dừng → sự kiện tập thể cũng dừng.
    if (this.active && event.kind !== 'like' && event.kind !== 'gift') this.contributeCollective(event.user.platformId, now);

    if (!this.running && event.kind !== 'gift') {
      this.record(event, 'game_stopped', null, 'Game đang dừng (vẫn vào hồ / làm mới hoạt động)');
      return 'game_stopped';
    }
    if (event.kind === 'comment') {
      // Việc vui và hành động cùng khớp: từ khoá dài hơn (cụ thể hơn) thắng, bằng nhau thì hành động thắng.
      const work = matchWork(event.text, this.config.work ?? []);
      if (work && (!match || work.keywordLength > (match.keywordLength ?? 0))) {
        return this.doWork(event, player, work.task, now);
      }
    }
    if (!match) {
      this.record(event, 'participated', null, describeEvent(event));
      // bình luận thường → bong bóng chat trên đầu người câu
      const text = event.kind === 'comment' ? event.text?.trim() : '';
      if (text) this.emit({ type: 'chat', data: { platformId: player.platformId, displayName: player.displayName, text, at: now } });
      return 'participated';
    }
    const { action } = match;

    if (!action.enabled) {
      this.record(event, 'disabled', action.id, `${action.name} đang tắt`);
      return 'disabled';
    }

    // Quà tặng không bị chặn bởi cooldown (người xem đã bỏ tiền), nhưng vẫn qua hàng đợi.
    const isGift = event.kind === 'gift';

    // Kích hoạt bằng bình luận/like/share chỉ dành cho cần thủ chính thức (đã follow). Quà luôn được.
    if (!isGift && action.trigger.followersOnly && !(event.user.follower === true || this.players.isFollower(player.platformId))) {
      this.record(event, 'filtered', action.id, 'Chỉ cần thủ chính thức (đã follow) mới kích hoạt bằng bình luận');
      this.pushFollowHint(event, now);
      return 'filtered';
    }

    if (!isGift && !this.cooldowns.check(action.id, player.platformId, action.cooldownMs, action.userCooldownMs, now)) {
      this.record(event, 'cooldown', action.id, `${action.name} đang hồi chiêu`);
      return 'cooldown';
    }

    // Quà → cân cố định (không may rủi khi người xem bỏ tiền — chính sách TikTok LIVE về trò may rủi).
    const fish = action.fish ? (isGift ? fixedBigFish(action.fish) : rollBigFish(action.fish, this.random)) : undefined;
    const outcome = this.enqueue(action, isGift ? action.priority + 100 : action.priority, {
      eventId: event.id,
      source: event.source,
      user: event.user,
      detail: describeEvent(event),
      fish
    });
    if (outcome !== 'accepted' && !isGift) {
      this.record(event, outcome, action.id, 'Hàng đợi đầy');
      return outcome;
    }

    this.cooldowns.mark(action.id, player.platformId, now);
    this.players.addActionPoints(player.platformId, action.points, action.id);
    // Cân cá to cộng ngay khi nhận (người tặng đã bỏ tiền — không mất cá kể cả khi hàng đợi đầy / bỏ hoạt ảnh).
    if (fish) {
      // Cá từ quà không tính vào danh hiệu (không có mốc thưởng cho việc tặng quà).
      this.players.creditFish(player.platformId, fish.kg, 0, undefined, !isGift);
      this.noteCatch(player.displayName, fish, now, true);
    }
    if (outcome !== 'accepted') {
      // Quà mà hàng đợi hoạt ảnh đầy (toàn quà ưu tiên cao hơn): vẫn cộng cá + điểm, báo lên feed thay cho hoạt ảnh.
      this.leaderboardDirty = true;
      this.pushFeed({
        id: this.newId(),
        at: now,
        source: event.source,
        actorName: event.user.displayName,
        actorAvatar: event.user.avatarUrl,
        actionId: action.id,
        text: fish ? `${action.name}: ${fish.emoji} ${describeFish(fish)}` : action.name
      });
      this.record(event, outcome, action.id, `Hàng đợi đầy — bỏ hoạt ảnh, vẫn cộng cá/điểm: ${describeEvent(event)} → ${action.name}${fish ? ` (${describeFish(fish)})` : ''}`);
      return outcome;
    }
    this.record(event, 'accepted', action.id, `${describeEvent(event)} → ${action.name}${fish ? ` (${describeFish(fish)})` : ''}`);
    this.pump(now);
    return 'accepted';
  }

  /**
   * Người đang bị admin mời rời hồ: ghi nhận lượt (điểm / kim cương đã cộng ở trên), quà khớp hành động có cá
   * thì vẫn cộng cân cố định — nhưng KHÔNG hiện gì lên overlay (không chat, việc vui, hoạt ảnh hay feed).
   */
  private ingestKicked(event: NormalizedEvent, player: PlayerRecord, action: ActionConfig | null, now: number): EventOutcome {
    if (event.kind === 'gift' && action && action.enabled) {
      const fish = action.fish ? fixedBigFish(action.fish) : undefined;
      this.players.addActionPoints(player.platformId, action.points, action.id);
      if (fish) {
        this.players.creditFish(player.platformId, fish.kg, 0, undefined, false);
        this.noteCatch(player.displayName, fish, now, true);
      }
      this.record(event, 'accepted', action.id, `Đang bị mời rời hồ — ghi nhận, không hiện overlay: ${describeEvent(event)}${fish ? ` (${describeFish(fish)})` : ''}`);
      return 'accepted';
    }
    this.record(event, 'filtered', null, `Đang bị mời rời hồ — không hiện overlay: ${describeEvent(event)}`);
    return 'filtered';
  }

  /** Admin bấm "Test hành động": bỏ qua bật/tắt và cooldown, không cộng điểm / cân cho ai. */
  triggerManual(actionId: string, displayName = 'Admin (test)'): EventOutcome {
    const action = this.config.actions.find((a) => a.id === actionId);
    if (!action) throw new UnknownActionError(`Không có hành động ${actionId}`);
    const now = this.clock.now();
    const user: LiveUser = { platformId: 'manual:admin', username: 'admin', displayName };
    const eventId = `manual:${this.newId()}`;
    const fish = action.fish ? rollBigFish(action.fish, this.random) : undefined;
    const outcome = this.enqueue(action, action.priority + 500, { eventId, source: 'manual', user, detail: 'Test thủ công', fish });
    this.recordRaw({
      eventId,
      source: 'manual',
      kind: 'comment',
      playerId: null,
      actorName: displayName,
      actionId,
      outcome,
      summary: `Test thủ công → ${action.name}`
    });
    this.pump(now);
    return outcome;
  }

  // --------------------------------------------------------------------------
  // Quản lý hồ (admin)
  // --------------------------------------------------------------------------
  /** Hồ câu cho admin: người đang ngồi + ai tới lượt cá thường kế tiếp. */
  lakeState(): LakeState {
    // Người mới chưa có cá được ưu tiên trước lượt xoay vòng.
    const nextTurnId = this.players.uncaughtSeated()[0] ?? this.players.peekNextInTurn();
    return { roster: this.players.roster(), nextTurnId, capacity: this.players.capacity };
  }

  /**
   * Admin mời một người rời hồ (troll, tên phản cảm…). Người đó không vào lại (bình luận hay tặng quà đều không)
   * và không hiện tên trên overlay trong KICK_REJOIN_BLOCK_MS. Trả về false nếu người đó không đang ngồi.
   */
  kick(platformId: string): boolean {
    const now = this.clock.now();
    const p = this.players.get(platformId);
    if (!this.players.kick(platformId, now, KICK_REJOIN_BLOCK_MS)) return false;
    const roster = this.players.roster();
    this.lastFrontKey = frontKey(roster);
    this.emit({ type: 'roster', data: roster });
    this.recordRaw({
      eventId: `kick:${this.newId()}`,
      source: 'manual',
      kind: 'comment',
      playerId: platformId,
      actorName: p?.displayName ?? platformId,
      actionId: null,
      outcome: 'filtered',
      summary: 'Admin mời rời hồ'
    });
    return true;
  }

  /**
   * Admin bấm "Cá to ngay": chạy cá to định kỳ ngay bây giờ (chọn đều một người đang ngồi), rồi hẹn lại chu kỳ.
   * Đang kéo cá quà thì hoãn tới ngay sau khi hàng đợi trống ('postponed') — quà luôn được ưu tiên.
   */
  triggerBigFishNow(): BigFishNowResult {
    if (!this.running) return 'not_running';
    if (this.players.seatedIds().length === 0) return 'empty';
    const action = this.config.actions.find((a) => a.id === this.config.fishing.bigFishActionId);
    if (!action || !action.enabled) return 'disabled';
    const now = this.clock.now();
    const busy = this.busyUntil(now) > now;
    this.bigFishAppears(now);
    return busy ? 'postponed' : 'started';
  }

  /** Thống kê phiên hiện tại. */
  sessionStats(): SessionStats {
    const s = this.stats;
    return {
      activeMs: s.activeMs,
      fishCaught: s.fishCaught,
      junkCaught: s.junkCaught,
      bigFishPulled: s.bigFishPulled,
      totalKg: gramsToKg(s.totalGrams),
      giftsReceived: s.giftsReceived,
      giftDiamonds: s.giftDiamonds,
      biggest: s.biggest ? { ...s.biggest } : null,
      queueLength: this.queue.length
    };
  }

  /** Ghi nhận một con cá lên vào thống kê phiên. */
  private noteCatch(displayName: string, fish: Catch, now: number, big: boolean): void {
    if (big) this.stats.bigFishPulled += 1;
    if (!(fish.kg > 0)) {
      this.stats.junkCaught += 1;
      return;
    }
    this.stats.fishCaught += 1;
    this.stats.totalGrams += kgToGrams(fish.kg);
    if (!this.stats.biggest || fish.kg > this.stats.biggest.kg) {
      this.stats.biggest = { displayName, emoji: fish.emoji, name: fish.name, kg: fish.kg, at: now };
    }
  }

  // --------------------------------------------------------------------------
  // Tick định kỳ (host gọi ~100ms/lần)
  // --------------------------------------------------------------------------
  tick(): void {
    const now = this.clock.now();
    const dt = now - this.lastTickAt;
    this.lastTickAt = now;

    this.king = recover(this.king, this.config.king, dt, now);
    this.broadcastKing(false);

    // Game dừng / LIVE đã kết thúc → câu tự động, cá to định kỳ, sự kiện tập thể (hết hạn / mở vòng) và mời rời hồ
    // vì ngồi không đều tạm dừng. Hoạt ảnh đang chờ (quà) vẫn chạy tiếp qua pump().
    if (this.active) {
      const c = this.collective.tick(now);
      if (c) this.emit({ type: 'collective', data: c.state });
    }

    if (this.active) {
      if (dt > 0) this.stats.activeMs += dt;
      if (this.players.kickIdle(now, this.config.fishing.idleKickMs).length > 0) this.leaderboardDirty = true;
      const tickMs = Math.max(1000, this.config.fishing.tickMs);
      if (now - this.lastFishingAt >= tickMs) {
        this.lastFishingAt = now;
        this.fishingRound(now, tickMs);
      }
      if (this.nextBigFishAt > 0 && now >= this.nextBigFishAt) {
        // Tới giờ: đợi thêm một tick để quà đến cùng lúc được xếp trước (quà luôn kéo ngay).
        if (this.bigFishArmedAt === 0) this.bigFishArmedAt = now;
        if (now > this.bigFishArmedAt) this.bigFishAppears(now);
      }
    }

    this.pump(now);
    this.flush(now, false);
  }

  // --------------------------------------------------------------------------
  // Nội bộ
  // --------------------------------------------------------------------------
  /**
   * Một chu kỳ câu: `catchesPerTick` con cá thường cắn câu, LẦN LƯỢT theo thứ tự vào hồ (xoay vòng);
   * mọi người đang ngồi được cộng thời gian câu. Phát gộp một tin 'catches'.
   */
  private fishingRound(now: number, tickMs: number): void {
    const seated = this.players.seatedIds();
    if (seated.length === 0) return;
    this.players.addFishingMs(seated, tickMs);
    const n = catchesThisTick(this.config.fishing, seated.length, tickMs);
    // Người mới vào chưa có con nào được ưu tiên con đầu tiên (trong ngân sách n); phần còn lại xoay vòng.
    const picked: string[] = this.players.uncaughtSeated().slice(0, n);
    const chosen = new Set(picked);
    for (let guard = 0; picked.length < n && guard < seated.length; guard++) {
      const id = this.players.nextInTurn();
      if (!id) break;
      if (chosen.has(id)) continue;
      chosen.add(id);
      picked.push(id);
    }
    const catches: CatchEvent[] = [];
    for (const id of picked) {
      const pick = pickLoot(this.config.fishing.loot, this.random);
      const p = this.players.get(id);
      if (!pick || !p) continue;
      const points = (pick.catch.kg > 0 ? CATCH_BASE_POINTS : 0) + pick.item.points;
      this.players.creditFish(id, pick.catch.kg, points, 'catch');
      this.players.markCaught(id);
      this.noteCatch(p.displayName, pick.catch, now, false);
      catches.push({ platformId: id, displayName: p.displayName, emoji: pick.catch.emoji, name: pick.catch.name, kg: pick.catch.kg, at: now });
    }
    this.leaderboardDirty = true;
    if (catches.length > 0) this.emit({ type: 'catches', data: catches });
  }

  /** Hẹn cá to định kỳ kế tiếp (0 = tắt) và báo HUD đếm ngược. */
  private scheduleBigFish(now: number): void {
    const every = this.config.fishing.bigFishEveryMs;
    this.nextBigFishAt = every > 0 ? now + every : 0;
    this.bigFishArmedAt = 0;
    this.bigFishPostponedSince = 0;
    this.emit({ type: 'bigfish.next', data: { at: this.nextBigFishAt, shadowMs: this.config.fishing.bigFishShadowMs } });
  }

  /** Ước lượng lúc hoạt ảnh đang chạy + đang chờ xong hết (= now nếu rảnh). */
  private busyUntil(now: number): number {
    let t = now;
    for (const r of this.scheduler.list()) t = Math.max(t, r.startedAt + r.durationMs);
    for (const it of this.queue.pending()) t += this.config.actions.find((a) => a.id === it.actionId)?.durationMs ?? 0;
    return t;
  }

  /** "CÁ TO XUẤT HIỆN!": chọn ngẫu nhiên đều một người đang ngồi và chạy hành động cá to. */
  private bigFishAppears(now: number): void {
    // Quà luôn được kéo ngay: đang có hoạt ảnh chạy / chờ thì hoãn cá to định kỳ tới khi hàng đợi trống.
    this.bigFishArmedAt = 0;
    const busyUntil = this.busyUntil(now);
    let overdue = false;
    if (busyUntil > now) {
      if (this.bigFishPostponedSince === 0) this.bigFishPostponedSince = now;
      const deadline = this.bigFishPostponedSince + BIG_FISH_MAX_POSTPONE_MS;
      if (now < deadline) {
        // Hoãn tới khi hàng đợi trống, nhưng không quá BIG_FISH_MAX_POSTPONE_MS kể từ lần hoãn đầu.
        this.nextBigFishAt = Math.min(busyUntil + BIG_FISH_POSTPONE_GAP_MS, deadline);
        this.emit({ type: 'bigfish.next', data: { at: this.nextBigFishAt, shadowMs: this.config.fishing.bigFishShadowMs } });
        return;
      }
      // Quà dồn liên tục đã hoãn quá lâu → chạy ngay sau hoạt ảnh đang chạy (sự kiện miễn phí không bị bỏ đói).
      overdue = true;
    }
    this.bigFishPostponedSince = 0;
    const roster = this.players.roster();
    const action = this.config.actions.find((a) => a.id === this.config.fishing.bigFishActionId);
    this.scheduleBigFish(now);
    if (roster.length === 0 || !action || !action.enabled) return;
    // Chọn đều giữa mọi người đang ngồi — chỗ ngồi (do quà quyết định) KHÔNG tăng cơ hội, tránh kiểu "trả tiền để may mắn".
    // Từ 2 người trở lên thì không chọn lại người vừa trúng lần trước.
    const pool = roster.length >= 2 ? roster.filter((m) => m.platformId !== this.lastBigFishWinner) : roster;
    const idx = Math.min(pool.length - 1, Math.floor(Math.max(0, this.random()) * pool.length));
    const winner = pool[idx]!;
    const p = this.players.get(winner.platformId);
    if (!p) return;
    this.lastBigFishWinner = p.platformId;
    const user: LiveUser = { platformId: p.platformId, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl };
    const fish = action.fish ? rollBigFish(action.fish, this.random) : undefined;
    const eventId = `bigfish:${this.newId()}`;
    const priority = overdue ? BIG_FISH_OVERDUE_PRIORITY : action.priority;
    const outcome = this.enqueue(action, priority, { eventId, source: 'collective', user, detail: action.name, fish });
    if (outcome === 'accepted') {
      this.players.addActionPoints(p.platformId, action.points, 'big_fish');
      if (fish) {
        this.players.creditFish(p.platformId, fish.kg, 0);
        this.noteCatch(p.displayName, fish, now, true);
      }
      this.leaderboardDirty = true;
    }
    this.recordRaw({
      eventId,
      source: 'collective',
      kind: 'collective',
      playerId: p.platformId,
      actorName: p.displayName,
      actionId: action.id,
      outcome,
      summary: `${action.name} → ${p.displayName}${fish ? ` (${describeFish(fish)})` : ''}`
    });
    this.pump(now);
  }

  /** Việc vui: cộng điểm + phát 'work' cho overlay. Không chạm Cá Thần, hàng đợi hay lane. */
  private doWork(event: NormalizedEvent, player: PlayerRecord, task: WorkTask, now: number): EventOutcome {
    const key = `work:${task.id}`;
    if (!this.cooldowns.check(key, player.platformId, 0, task.userCooldownMs, now)) {
      this.record(event, 'participated', null, `${task.name} đang hồi chiêu`);
      return 'participated';
    }
    this.cooldowns.mark(key, player.platformId, now);
    // Việc có loot (admin tự thêm): bốc một món, cộng cân + điểm thưởng.
    const pick = task.loot && task.loot.length > 0 ? pickLoot(task.loot, this.random) : null;
    const points = task.points + (pick?.item.points ?? 0);
    this.players.addActionPoints(player.platformId, points, key);
    if (pick) {
      this.players.creditFish(player.platformId, pick.catch.kg, 0);
      this.noteCatch(player.displayName, pick.catch, now, false);
    }
    this.leaderboardDirty = true;
    const text = pick ? fillCatchText(task.text, pick.catch) : task.text;
    this.emit({
      type: 'work',
      data: {
        platformId: player.platformId,
        displayName: event.user.displayName,
        taskId: task.id,
        emoji: pick ? pick.catch.emoji : task.emoji,
        text,
        at: now,
        points,
        ...(pick ? { catch: pick.catch } : {})
      }
    });
    this.record(event, 'work', null, task.name);
    this.pushFeed({
      id: this.newId(),
      at: now,
      source: event.source,
      actorName: event.user.displayName,
      actorAvatar: event.user.avatarUrl,
      actionId: null,
      text: pick ? `${pick.catch.emoji} ${task.name}: ${describeFish(pick.catch)}` : `${task.emoji} ${task.name}`
    });
    return 'work';
  }

  /** Nhắc cần thủ tập sự follow (câu chữ trung tính, không xin quà) — tối đa 1 lần mỗi người mỗi FOLLOW_HINT_MS. */
  private pushFollowHint(event: NormalizedEvent, now: number): void {
    const id = event.user.platformId;
    const last = this.hintAt.get(id);
    if (last !== undefined && now - last < FOLLOW_HINT_MS) return;
    this.hintAt.delete(id);
    this.hintAt.set(id, now);
    if (this.hintAt.size > 10_000) this.hintAt.delete(this.hintAt.keys().next().value as string);
    this.pushFeed({
      id: this.newId(),
      at: now,
      source: event.source,
      actorName: event.user.displayName,
      actorAvatar: event.user.avatarUrl,
      actionId: null,
      text: FOLLOW_HINT_TEXT
    });
  }

  private enqueue(action: ActionConfig, priority: number, payload: QueuedPayload): EventOutcome {
    const now = this.clock.now();
    const res = this.queue.push({ actionId: action.id, lanes: action.lanes, priority, enqueuedAt: now, payload });
    if (!res.ok) return 'dropped';
    if (res.dropped) this.recordDropped(res.dropped, 'dropped');
    this.emit({ type: 'queue', data: { length: this.queue.length } });
    return 'accepted';
  }

  private pump(now: number): void {
    for (const r of this.scheduler.finishDue(now)) {
      this.emit({ type: 'action.ended', data: { runId: r.runId, actionId: r.actionId } });
    }

    for (const it of this.queue.removeExpired(now, this.config.limits.queueMaxWaitMs)) {
      this.recordDropped(it, 'expired');
    }

    let started = false;
    while (this.scheduler.hasCapacity()) {
      const item = this.queue.popRunnable(this.scheduler.busyLanes());
      if (!item) break;
      this.startItem(item, now);
      started = true;
    }
    if (started) this.emit({ type: 'queue', data: { length: this.queue.length } });
  }

  private startItem(item: QueueItem<QueuedPayload>, now: number): void {
    const action = this.config.actions.find((a) => a.id === item.actionId);
    if (!action) return;
    const { payload } = item;
    const run: RunningAction = {
      runId: this.newId(),
      actionId: action.id,
      actionName: action.name,
      lanes: [...action.lanes],
      actor: payload.user ? { displayName: payload.user.displayName, avatarUrl: payload.user.avatarUrl } : null,
      source: payload.source,
      startedAt: now,
      durationMs: action.durationMs,
      ...(payload.fish ? { fish: { ...payload.fish } } : {})
    };
    this.scheduler.start(run);
    this.king = applyEffect(this.king, action.kingEffect, this.config.king, now, {
      actionId: action.id,
      actorName: payload.user?.displayName ?? null
    });
    this.emit({ type: 'action.started', data: run });
    this.broadcastKing(true);
    this.pushFeed({
      id: run.runId,
      at: now,
      source: payload.source,
      actorName: payload.user?.displayName ?? CROWD_NAME,
      actorAvatar: payload.user?.avatarUrl,
      actionId: action.id,
      text: payload.fish ? `${action.name}: ${payload.fish.emoji} ${describeFish(payload.fish)}` : action.name
    });
  }

  private contributeCollective(userKey: string, now: number): void {
    const res = this.collective.contribute(userKey, now);
    if (!res) return;
    const state = this.collective.current;
    if (res === 'completed' && state) {
      const cfg = this.collective.config;
      // Người góp sức rồi bị admin mời rời hồ thì không được danh hiệu / phần chia.
      const contributors = this.collective.contributorIds.filter((id) => !this.players.isKicked(id, now));
      for (const id of contributors) this.players.grantTitle(id, cfg.rewardTitle);
      const action = this.config.actions.find((a) => a.id === cfg.actionId);
      if (action) {
        const eventId = `collective:${state.roundId}`;
        const fish = action.fish ? rollBigFish(action.fish, this.random) : undefined;
        const outcome = this.enqueue(action, action.priority + 1000, {
          eventId,
          source: 'collective',
          user: null,
          detail: state.name,
          fish
        });
        // Cân Cá Thần chia đều (theo gram) cho mọi người góp sức.
        if (fish && contributors.length > 0) {
          const share = gramsToKg(Math.floor(kgToGrams(fish.kg) / contributors.length));
          for (const id of contributors) this.players.creditFish(id, share, 0);
          this.noteCatch(`${CROWD_NAME} (${contributors.length} người)`, fish, now, true);
          this.leaderboardDirty = true;
        }
        this.recordRaw({
          eventId,
          source: 'collective',
          kind: 'collective',
          playerId: null,
          actorName: `${state.participants} cần thủ`,
          actionId: action.id,
          outcome,
          summary: `Hoàn thành "${state.name}" (${state.goal} lượt)${fish ? ` — ${describeFish(fish)} chia cho ${contributors.length} người` : ''}`
        });
        this.pump(now);
      }
    }
    if (res === 'completed') {
      this.collectiveMsgDirty = false;
      this.emit({ type: 'collective', data: state });
    } else {
      // Tiến trình (mỗi bình luận +1) gom vào flush — LIVE đông không phát một tin cho từng bình luận.
      this.collectiveMsgDirty = true;
      this.flush(now, false);
    }
  }

  /** Phát roster ngay khi danh sách / thứ tự Bến Vàng đổi (quà vừa đẩy ai đó lên); còn lại chờ flush. */
  private emitRosterIfFrontChanged(): void {
    const roster = this.players.roster();
    const key = frontKey(roster);
    if (key === this.lastFrontKey) return;
    this.lastFrontKey = key;
    this.emit({ type: 'roster', data: roster });
  }

  /**
   * Bỏ mọi dấu vết người chơi demo khỏi phiên (khi chuyển sang TikTok LIVE thật): rời hồ, khỏi bảng phiên,
   * hoạt ảnh đang chờ của họ, và mở lại vòng tập thể nếu có lượt góp demo. Trả về số người demo đã gỡ.
   */
  purgeDemo(): number {
    const now = this.clock.now();
    const removed = this.players.purge(isDemoPlayer);
    const dropped = this.queue.removeWhere((it) => !!it.payload.user && isDemoPlayer(it.payload.user.platformId));
    if (this.collective.contributorIds.some(isDemoPlayer)) {
      this.collective.reset(now);
      this.emit({ type: 'collective', data: this.collective.current });
    }
    if (removed === 0 && dropped.length === 0) return 0;
    this.lastFrontKey = null;
    this.leaderboardDirty = true;
    this.emit({ type: 'queue', data: { length: this.queue.length } });
    this.flush(now, true);
    return removed;
  }

  private broadcastKing(force: boolean): void {
    if (!force && !kingChangedMeaningfully(this.lastBroadcastKing, this.king)) return;
    this.lastBroadcastKing = this.king;
    this.emit({ type: 'king', data: { ...this.king } });
  }

  private pushFeed(item: FeedItem): void {
    this.feed.unshift(item);
    if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
    this.feedDirty = true;
    this.leaderboardDirty = true;
    this.flush(item.at, false);
  }

  /** Gom các cập nhật leaderboard/feed/roster, tối đa 1 lần mỗi broadcastIntervalMs. */
  private flush(now: number, force: boolean): void {
    if (!force && now - this.lastFlushAt < this.broadcastIntervalMs) return;
    if (!this.feedDirty && !this.leaderboardDirty && !this.collectiveMsgDirty) return;
    this.lastFlushAt = now;
    if (this.collectiveMsgDirty) {
      this.collectiveMsgDirty = false;
      this.emit({ type: 'collective', data: this.collective.current });
    }
    if (this.feedDirty) {
      this.feedDirty = false;
      this.emit({ type: 'feed', data: this.feed.slice(0, 10) });
    }
    if (this.leaderboardDirty) {
      this.leaderboardDirty = false;
      this.emit({
        type: 'leaderboard',
        data: {
          entries: this.players.leaderboard('session', 10),
          kgBoard: this.players.kgBoard('session', 10),
          participants: this.players.participants()
        }
      });
      const roster = this.players.roster();
      this.lastFrontKey = frontKey(roster);
      this.emit({ type: 'roster', data: roster });
    }
  }

  private record(event: NormalizedEvent, outcome: EventOutcome, actionId: string | null, summary: string): void {
    // Thả tim bị chặn/không khớp rất nhiều — không ghi lịch sử để tránh ngập DB.
    if (event.kind === 'like' && outcome !== 'accepted') return;
    this.recordRaw({
      eventId: event.id,
      source: event.source,
      kind: event.kind,
      playerId: event.user.platformId,
      actorName: event.user.displayName,
      actionId,
      outcome,
      summary
    });
  }

  private recordDropped(item: QueueItem<QueuedPayload>, outcome: 'dropped' | 'expired'): void {
    this.recordRaw({
      eventId: item.payload.eventId,
      source: item.payload.source,
      kind: item.payload.source === 'collective' ? 'collective' : 'comment',
      playerId: item.payload.user?.platformId ?? null,
      actorName: item.payload.user?.displayName ?? CROWD_NAME,
      actionId: item.actionId,
      outcome,
      summary: outcome === 'expired' ? 'Chờ quá lâu trong hàng đợi' : 'Bị đẩy khỏi hàng đợi bởi hành động ưu tiên hơn'
    });
  }

  private recordRaw(e: Omit<HistoryEntry, 'id' | 'sessionId' | 'createdAt'>): void {
    this.emit({
      type: 'history',
      data: { ...e, id: this.newId(), sessionId: this.sessionId, createdAt: this.clock.now() }
    });
  }

  private makeLimiter(now: number): RateLimiter {
    const l = this.config.limits;
    return new RateLimiter(
      {
        userCapacity: l.userBucketCapacity,
        userRefillPerSec: l.userBucketRefillPerSec,
        globalCapacity: l.globalBucketCapacity,
        globalRefillPerSec: l.globalBucketRefillPerSec
      },
      now
    );
  }

  snapshot(): GameSnapshot {
    return {
      running: this.running,
      streamOffline: this.streamOffline,
      sessionId: this.sessionId,
      king: { ...this.king },
      runningActions: this.scheduler.list(),
      queueLength: this.queue.length,
      feed: this.feed.slice(0, 10),
      leaderboard: this.players.leaderboard('session', 10),
      kgBoard: this.players.kgBoard('session', 10),
      participants: this.players.participants(),
      nextBigFishAt: this.nextBigFishAt,
      bigFishShadowMs: this.config.fishing.bigFishShadowMs,
      roster: this.players.roster(),
      collective: this.collective.current,
      connectors: this.connectors,
      serverTime: this.clock.now()
    };
  }

  /** Dùng cho lớp lưu trữ. */
  loadPlayers(records: PlayerRecord[]): void {
    this.players.load(records);
  }

  /**
   * Sau khi khởi động lại: gắn lại phiên LIVE đang mở và bộ đếm phiên đã lưu (game vẫn dừng — host quyết định
   * có chạy tiếp không). Người ngồi trong hồ không được khôi phục (chỉ có trong bộ nhớ).
   */
  restoreSession(sessionId: string, stats: readonly { playerId: string; stat: SessionStat }[]): void {
    this.sessionId = sessionId;
    this.players.loadSession(stats);
    this.leaderboardDirty = true;
  }

  /** Mốc sự kiện LIVE hợp lệ gần nhất được xử lý (0 = chưa có) — để quyết định tự chạy lại sau khi khởi động. */
  get lastActivityAt(): number {
    return this.lastEventAt;
  }
}

/**
 * Số cá thường mỗi chu kỳ: clamp(ceil(N × tickMs / targetCatchMs), catchesPerTick, maxCatchesPerTick), không quá N.
 * Hồ càng đông càng nhiều cá mỗi chu kỳ để mỗi người vẫn được cá khoảng mỗi `targetCatchMs`.
 */
export function catchesThisTick(f: FishingConfig, seated: number, tickMs: number): number {
  if (seated <= 0) return 0;
  const target = f.targetCatchMs && f.targetCatchMs > 0 ? f.targetCatchMs : DEFAULT_TARGET_CATCH_MS;
  const min = Math.max(1, Math.floor(f.catchesPerTick || 1));
  const max = Math.max(min, Math.floor(f.maxCatchesPerTick && f.maxCatchesPerTick > 0 ? f.maxCatchesPerTick : DEFAULT_MAX_CATCHES_PER_TICK));
  const want = Math.ceil((seated * tickMs) / target);
  return Math.min(seated, Math.max(min, Math.min(max, want)));
}

/** Admin gọi một hành động không tồn tại (HTTP 404). */
export class UnknownActionError extends Error {}

/** Khoá so sánh danh sách + thứ tự Bến Vàng. */
const frontKey = (roster: readonly RosterMember[]): string =>
  roster
    .filter((m) => m.seat === 'front')
    .map((m) => m.platformId)
    .join('\u0000');

const describeFish = (f: Catch) => (f.kg > 0 ? `${f.name} ${formatKg(f.kg)}kg` : f.name);

function describeEvent(e: NormalizedEvent): string {
  switch (e.kind) {
    case 'comment':
      return `Bình luận: "${(e.text ?? '').slice(0, 60)}"`;
    case 'gift':
      return e.gift ? `Tặng ${e.gift.count}x ${e.gift.name} (id ${e.gift.giftId}, ${giftValue(e.gift)} kim cương)` : 'Tặng quà';
    case 'like':
      return `Thả ${e.likeCount ?? 1} tim`;
    case 'share':
      return 'Chia sẻ LIVE';
    case 'follow':
      return 'Theo dõi kênh';
    default:
      return e.kind;
  }
}

/** Bản sao cấu hình với `limits.maxConcurrent` ép về MAX_CONCURRENT_ACTIONS (snapshot/dashboard thấy đúng giá trị thật). */
function serialized(cfg: GameConfig): GameConfig {
  const c = structuredClone(cfg);
  c.limits = { ...c.limits, maxConcurrent: MAX_CONCURRENT_ACTIONS };
  return c;
}
