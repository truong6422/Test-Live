import type {
  ActionConfig,
  CatchEvent,
  ConnectorInfo,
  EventKind,
  EventOutcome,
  EventSource,
  FeedItem,
  GameConfig,
  GameSnapshot,
  HistoryEntry,
  KingState,
  LiveUser,
  NormalizedEvent,
  LakeState,
  RunningAction,
  ServerMessage,
  SessionStats,
  WorkTask
} from '@cau/shared';
import { applyEffect, initialKing, kingChangedMeaningfully, recover, setCalm } from './king';
import type { Clock } from './clock';
import { CollectiveTracker } from './collective';
import { CooldownTracker } from './cooldown';
import { Deduper } from './dedupe';
import { fillCatchText, formatKg, gramsToKg, kgToGrams, pickLoot, rollBigFish, type Catch, type Random } from './loot';
import { giftValue, matchAction, matchWork } from './matcher';
import { ActionQueue, type QueueItem } from './queue';
import { RateLimiter } from './rate-limit';
import { AnimationScheduler } from './scheduler';
import { PlayerRegistry, type PlayerRecord } from '../players/players';

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
export const FOLLOW_HINT_TEXT = 'Follow kênh để kéo cá to bằng bình luận — hoặc tặng quà để kéo cá to ngay!';

/** Tên hiển thị khi người kích hoạt là cả hồ (sự kiện tập thể). */
const CROWD_NAME = 'Cả hồ';
/** Cá to định kỳ bị hoãn vì đang kéo cá quà: chờ thêm chừng này sau khi hàng đợi dự kiến trống. */
export const BIG_FISH_POSTPONE_GAP_MS = 1000;
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

  private listeners = new Set<EngineListener>();
  /** Thống kê phiên (chỉ trong bộ nhớ). */
  private stats: StatsCounter = emptyStats();
  private lastTickAt: number;
  private leaderboardDirty = false;
  private feedDirty = false;
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
    if (this.nextBigFishAt === 0) this.scheduleBigFish(now);
    this.emit({ type: 'game', data: { running: true, sessionId } });
    this.emit({ type: 'collective', data: this.collective.current });
  }

  stop(): void {
    this.running = false;
    this.queue.clear();
    this.emit({ type: 'game', data: { running: false, sessionId: this.sessionId } });
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
    this.collective.reset(now);
    this.sessionId = newSessionId;
    this.lastFishingAt = now;
    this.scheduleBigFish(now);
    this.emit({ type: 'snapshot', data: this.snapshot() });
  }

  get isRunning(): boolean {
    return this.running;
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

    if (!this.running) {
      this.record(event, 'game_stopped', null, 'Game đang dừng');
      return 'game_stopped';
    }

    if (this.deduper.isDuplicate(event.id, now)) {
      this.record(event, 'deduped', null, 'Sự kiện trùng');
      return 'deduped';
    }

    if (!this.limiter.allow(event.user.platformId, now)) {
      this.record(event, 'rate_limited', null, 'Vượt giới hạn tần suất');
      return 'rate_limited';
    }

    // Mọi lượt tham gia hợp lệ đều được ghi nhận, kể cả không khớp hành động nào.
    const diamonds = event.kind === 'gift' && event.gift ? giftValue(event.gift) : 0;
    const basePoints = event.kind === 'gift' ? diamonds : BASE_POINTS[event.kind];
    const player = this.players.participate(event.user, basePoints);
    if (event.kind === 'follow') this.players.markFollower(event.user.platformId);
    // Bình luận / tặng quà bất kỳ → vào hồ ngồi câu.
    // (Người vừa bị admin mời rời hồ chỉ vào lại được bằng quà cho tới hết KICK_REJOIN_BLOCK_MS.)
    if (event.kind === 'comment' || event.kind === 'gift') this.players.join(player.platformId, now, event.kind === 'gift');
    // TOP QUÀ TẶNG tính theo kim cương đã tặng.
    if (diamonds > 0) this.players.addDiamonds(event.user.platformId, diamonds);
    if (event.kind === 'gift') {
      this.stats.giftsReceived += 1;
      this.stats.giftDiamonds += diamonds;
    }
    this.leaderboardDirty = true;
    // Quà làm đổi thứ hạng kim cương → xếp lại chỗ ngồi và phát roster NGAY (lên chiếu giữa tức thì, không chờ tick).
    if (event.kind === 'gift') this.emit({ type: 'roster', data: this.players.roster() });
    if (event.kind !== 'like') this.contributeCollective(event.user.platformId, now);

    const match = matchAction(event, this.config.actions, this.config.gifts);
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

    const fish = action.fish ? rollBigFish(action.fish, this.random) : undefined;
    const outcome = this.enqueue(action, isGift ? action.priority + 100 : action.priority, {
      eventId: event.id,
      source: event.source,
      user: event.user,
      detail: describeEvent(event),
      fish
    });
    if (outcome !== 'accepted') {
      this.record(event, outcome, action.id, 'Hàng đợi đầy');
      return outcome;
    }

    this.cooldowns.mark(action.id, player.platformId, now);
    this.players.addActionPoints(player.platformId, action.points, action.id);
    // Cân cá to cộng ngay khi nhận (người tặng đã bỏ tiền — không mất cá nếu hàng đợi bỏ hoạt ảnh).
    if (fish) {
      this.players.creditFish(player.platformId, fish.kg, 0);
      this.noteCatch(player.displayName, fish, now, true);
    }
    this.record(event, 'accepted', action.id, `${describeEvent(event)} → ${action.name}${fish ? ` (${describeFish(fish)})` : ''}`);
    this.pump(now);
    return 'accepted';
  }

  /** Admin bấm "Test hành động": bỏ qua bật/tắt và cooldown, không cộng điểm / cân cho ai. */
  triggerManual(actionId: string, displayName = 'Admin (test)'): EventOutcome {
    const action = this.config.actions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Không có hành động ${actionId}`);
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
    return { roster: this.players.roster(), nextTurnId: this.players.peekNextInTurn(), capacity: this.players.capacity };
  }

  /**
   * Admin mời một người rời hồ (troll, tên phản cảm…). Người đó không tự vào lại bằng bình luận trong
   * KICK_REJOIN_BLOCK_MS (tặng quà vẫn vào). Trả về false nếu người đó không đang ngồi.
   */
  kick(platformId: string): boolean {
    const now = this.clock.now();
    const p = this.players.get(platformId);
    if (!this.players.kick(platformId, now, KICK_REJOIN_BLOCK_MS)) return false;
    this.emit({ type: 'roster', data: this.players.roster() });
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

    const c = this.collective.tick(now);
    if (c) this.emit({ type: 'collective', data: c.state });

    if (this.running) {
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
    const n = Math.min(seated.length, Math.max(1, Math.floor(this.config.fishing.catchesPerTick || 1)));
    const catches: CatchEvent[] = [];
    for (let k = 0; k < n; k++) {
      const id = this.players.nextInTurn();
      if (!id) break;
      const pick = pickLoot(this.config.fishing.loot, this.random);
      const p = this.players.get(id);
      if (!pick || !p) continue;
      const points = (pick.catch.kg > 0 ? CATCH_BASE_POINTS : 0) + pick.item.points;
      this.players.creditFish(id, pick.catch.kg, points, 'catch');
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
    if (busyUntil > now) {
      this.nextBigFishAt = busyUntil + BIG_FISH_POSTPONE_GAP_MS;
      this.emit({ type: 'bigfish.next', data: { at: this.nextBigFishAt, shadowMs: this.config.fishing.bigFishShadowMs } });
      return;
    }
    const roster = this.players.roster();
    const action = this.config.actions.find((a) => a.id === this.config.fishing.bigFishActionId);
    this.scheduleBigFish(now);
    if (roster.length === 0 || !action || !action.enabled) return;
    // Chọn đều giữa mọi người đang ngồi — chỗ ngồi (do quà quyết định) KHÔNG tăng cơ hội, tránh kiểu "trả tiền để may mắn".
    const idx = Math.min(roster.length - 1, Math.floor(Math.max(0, this.random()) * roster.length));
    const winner = roster[idx]!;
    const p = this.players.get(winner.platformId);
    if (!p) return;
    const user: LiveUser = { platformId: p.platformId, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl };
    const fish = action.fish ? rollBigFish(action.fish, this.random) : undefined;
    const eventId = `bigfish:${this.newId()}`;
    const outcome = this.enqueue(action, action.priority, { eventId, source: 'collective', user, detail: action.name, fish });
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

  /** Nhắc cần thủ tập sự follow / tặng quà — tối đa 1 lần mỗi người mỗi FOLLOW_HINT_MS. */
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
      const contributors = this.collective.contributorIds;
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
    this.emit({ type: 'collective', data: state });
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
    if (!this.feedDirty && !this.leaderboardDirty) return;
    this.lastFlushAt = now;
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
      this.emit({ type: 'roster', data: this.players.roster() });
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
}

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
