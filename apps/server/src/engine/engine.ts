import type {
  ActionConfig,
  BossState,
  ConnectorInfo,
  EventKind,
  EventOutcome,
  EventSource,
  FeedItem,
  GameConfig,
  GameSnapshot,
  HistoryEntry,
  LiveUser,
  NormalizedEvent,
  RunningAction,
  ServerMessage,
  WorkTask
} from '@sep/shared';
import { applyEffect, bossChangedMeaningfully, initialBoss, recover, setCalm } from './boss';
import type { Clock } from './clock';
import { CollectiveTracker } from './collective';
import { CooldownTracker } from './cooldown';
import { Deduper } from './dedupe';
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
}

export type EngineListener = (msg: ServerMessage) => void;

export interface EngineOptions {
  clock: Clock;
  config: GameConfig;
  newId?: () => string;
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

const FEED_MAX = 30;
/** Hành động chạy nối tiếp: cái trước kết thúc mới bắt đầu cái sau, bất kể limits.maxConcurrent đã lưu. */
export const MAX_CONCURRENT_ACTIONS = 1;

/** Khoảng cách tối thiểu giữa hai lần nhắc follow cho cùng một người. */
const FOLLOW_HINT_MS = 60_000;
export const FOLLOW_HINT_TEXT = 'Follow kênh để trêu Sếp bằng bình luận — hoặc tặng quà để trêu ngay!';

/**
 * GAME ENGINE — luồng xử lý:
 *  1 nhận NormalizedEvent → 2 kiểm tra game đang chạy → 3 chống trùng → 4 giới hạn tần suất
 *  → 5 ghi nhận nhân viên + điểm + sự kiện tập thể → 6 ánh xạ hành động → 7 bật/tắt, cooldown
 *  → 8 đưa vào hàng đợi ưu tiên → 9 scheduler khởi chạy, cập nhật Sếp → 10 phát qua listener + lịch sử.
 *
 * Engine không làm I/O: thời gian lấy từ `clock`, kết quả đi qua listener. Host gọi tick() định kỳ.
 */
export class GameEngine {
  private config: GameConfig;
  private readonly clock: Clock;
  private readonly newId: () => string;
  private readonly broadcastIntervalMs: number;

  private running = false;
  private sessionId: string | null = null;

  private boss: BossState = initialBoss();
  private lastBroadcastBoss: BossState = initialBoss();
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

  private listeners = new Set<EngineListener>();
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
    this.broadcastIntervalMs = opts.broadcastIntervalMs ?? 250;
    const now = this.clock.now();
    this.lastTickAt = now;
    this.queue = new ActionQueue(this.config.limits.maxQueue);
    this.scheduler = new AnimationScheduler(MAX_CONCURRENT_ACTIONS);
    this.limiter = this.makeLimiter(now);
    this.collective = new CollectiveTracker(this.config.collective, this.newId);
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
    if (!this.collective.current) this.collective.start(now);
    this.emit({ type: 'game', data: { running: true, sessionId } });
    this.emit({ type: 'collective', data: this.collective.current });
  }

  stop(): void {
    this.running = false;
    this.queue.clear();
    this.emit({ type: 'game', data: { running: false, sessionId: this.sessionId } });
    this.emit({ type: 'queue', data: { length: 0 } });
  }

  /** Bắt đầu phiên LIVE mới: xoá thống kê phiên, hàng đợi, hoạt ảnh, Sếp, sự kiện tập thể. */
  resetSession(newSessionId: string): void {
    const now = this.clock.now();
    for (const r of this.scheduler.clear()) this.emit({ type: 'action.ended', data: { runId: r.runId, actionId: r.actionId } });
    this.queue.clear();
    this.cooldowns.reset();
    this.hintAt.clear();
    this.players.resetSession();
    this.boss = initialBoss();
    this.lastBroadcastBoss = this.boss;
    this.feed = [];
    this.collective.reset(now);
    this.sessionId = newSessionId;
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
    this.config = next;
    this.queue.setMaxSize(cfg.limits.maxQueue);
    if (limitsChanged) this.limiter = this.makeLimiter(now);
    this.collective.setConfig(cfg.collective, now);
    this.emit({ type: 'collective', data: this.collective.current });
  }

  setConnectors(info: ConnectorInfo): void {
    this.connectors = info;
    this.emit({ type: 'connectors', data: info });
  }

  setBossCalm(calm: number): void {
    this.boss = setCalm(this.boss, calm, this.clock.now());
    this.broadcastBoss(true);
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
    // Bảng xếp hạng "phá Sếp" tính theo kim cương đã tặng.
    if (diamonds > 0) this.players.addDiamonds(event.user.platformId, diamonds);
    this.leaderboardDirty = true;
    if (event.kind !== 'like') this.contributeCollective(event.user.platformId, now);

    const match = matchAction(event, this.config.actions, this.config.gifts);
    if (event.kind === 'comment') {
      // Công việc và hành động cùng khớp: từ khoá dài hơn (cụ thể hơn) thắng, bằng nhau thì hành động thắng.
      const work = matchWork(event.text, this.config.work ?? []);
      if (work && (!match || work.keywordLength > (match.keywordLength ?? 0))) {
        return this.doWork(event, player, work.task, now);
      }
    }
    if (!match) {
      this.record(event, 'participated', null, describeEvent(event));
      return 'participated';
    }
    const { action } = match;

    if (!action.enabled) {
      this.record(event, 'disabled', action.id, `${action.name} đang tắt`);
      return 'disabled';
    }

    // Quà tặng không bị chặn bởi cooldown (người xem đã bỏ tiền), nhưng vẫn qua hàng đợi.
    const isGift = event.kind === 'gift';

    // "Trêu Sếp" bằng bình luận/like/share chỉ dành cho nhân viên chính thức (đã follow). Quà luôn được.
    if (!isGift && action.trigger.followersOnly && !(event.user.follower === true || this.players.isFollower(player.platformId))) {
      this.record(event, 'filtered', action.id, 'Chỉ nhân viên chính thức (đã follow) mới trêu Sếp bằng bình luận');
      this.pushFollowHint(event, now);
      return 'filtered';
    }

    if (!isGift && !this.cooldowns.check(action.id, player.platformId, action.cooldownMs, action.userCooldownMs, now)) {
      this.record(event, 'cooldown', action.id, `${action.name} đang hồi chiêu`);
      return 'cooldown';
    }

    const outcome = this.enqueue(action, isGift ? action.priority + 100 : action.priority, {
      eventId: event.id,
      source: event.source,
      user: event.user,
      detail: describeEvent(event)
    });
    if (outcome !== 'accepted') {
      this.record(event, outcome, action.id, 'Hàng đợi đầy');
      return outcome;
    }

    this.cooldowns.mark(action.id, player.platformId, now);
    this.players.addActionPoints(player.platformId, action.points, action.id);
    this.record(event, 'accepted', action.id, `${describeEvent(event)} → ${action.name}`);
    this.pump(now);
    return 'accepted';
  }

  /** Admin bấm "Test hành động": bỏ qua bật/tắt và cooldown, không cộng điểm cho ai. */
  triggerManual(actionId: string, displayName = 'Admin (test)'): EventOutcome {
    const action = this.config.actions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Không có hành động ${actionId}`);
    const now = this.clock.now();
    const user: LiveUser = { platformId: 'manual:admin', username: 'admin', displayName };
    const eventId = `manual:${this.newId()}`;
    const outcome = this.enqueue(action, action.priority + 500, { eventId, source: 'manual', user, detail: 'Test thủ công' });
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
  // Tick định kỳ (host gọi ~100ms/lần)
  // --------------------------------------------------------------------------
  tick(): void {
    const now = this.clock.now();
    const dt = now - this.lastTickAt;
    this.lastTickAt = now;

    this.boss = recover(this.boss, this.config.boss, dt, now);
    this.broadcastBoss(false);

    const c = this.collective.tick(now);
    if (c) this.emit({ type: 'collective', data: c.state });

    this.pump(now);
    this.flush(now, false);
  }

  // --------------------------------------------------------------------------
  // Nội bộ
  // --------------------------------------------------------------------------
  /** Làm một công việc: cộng điểm + phát 'work' cho overlay. Không chạm Sếp, hàng đợi hay lane. */
  private doWork(event: NormalizedEvent, player: PlayerRecord, task: WorkTask, now: number): EventOutcome {
    const key = `work:${task.id}`;
    if (!this.cooldowns.check(key, player.platformId, 0, task.userCooldownMs, now)) {
      this.record(event, 'participated', null, `${task.name} đang hồi chiêu`);
      return 'participated';
    }
    this.cooldowns.mark(key, player.platformId, now);
    this.players.addActionPoints(player.platformId, task.points, key);
    this.leaderboardDirty = true;
    this.emit({
      type: 'work',
      data: {
        platformId: player.platformId,
        displayName: event.user.displayName,
        taskId: task.id,
        emoji: task.emoji,
        text: task.text,
        at: now
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
      text: `${task.emoji} ${task.name}`
    });
    return 'work';
  }

  /** Nhắc thực tập sinh follow / tặng quà — tối đa 1 lần mỗi người mỗi FOLLOW_HINT_MS. */
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
      durationMs: action.durationMs
    };
    this.scheduler.start(run);
    this.boss = applyEffect(this.boss, action.bossEffect, this.config.boss, now, {
      actionId: action.id,
      actorName: payload.user?.displayName ?? null
    });
    this.emit({ type: 'action.started', data: run });
    this.broadcastBoss(true);
    this.pushFeed({
      id: run.runId,
      at: now,
      source: payload.source,
      actorName: payload.user?.displayName ?? 'Cả công ty',
      actorAvatar: payload.user?.avatarUrl,
      actionId: action.id,
      text: action.name
    });
  }

  private contributeCollective(userKey: string, now: number): void {
    const res = this.collective.contribute(userKey, now);
    if (!res) return;
    const state = this.collective.current;
    if (res === 'completed' && state) {
      const cfg = this.collective.config;
      for (const id of this.collective.contributorIds) this.players.grantTitle(id, cfg.rewardTitle);
      const action = this.config.actions.find((a) => a.id === cfg.actionId);
      if (action) {
        const eventId = `collective:${state.roundId}`;
        const outcome = this.enqueue(action, action.priority + 1000, {
          eventId,
          source: 'collective',
          user: null,
          detail: state.name
        });
        this.recordRaw({
          eventId,
          source: 'collective',
          kind: 'collective',
          playerId: null,
          actorName: `${state.participants} nhân viên`,
          actionId: action.id,
          outcome,
          summary: `Hoàn thành "${state.name}" (${state.goal} lượt)`
        });
        this.pump(now);
      }
    }
    this.emit({ type: 'collective', data: state });
  }

  private broadcastBoss(force: boolean): void {
    if (!force && !bossChangedMeaningfully(this.lastBroadcastBoss, this.boss)) return;
    this.lastBroadcastBoss = this.boss;
    this.emit({ type: 'boss', data: { ...this.boss } });
  }

  private pushFeed(item: FeedItem): void {
    this.feed.unshift(item);
    if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
    this.feedDirty = true;
    this.leaderboardDirty = true;
    this.flush(item.at, false);
  }

  /** Gom các cập nhật leaderboard/feed, tối đa 1 lần mỗi broadcastIntervalMs. */
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
        data: { entries: this.players.leaderboard('session', 10), participants: this.players.participants() }
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
      actorName: item.payload.user?.displayName ?? 'Cả công ty',
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
      boss: { ...this.boss },
      runningActions: this.scheduler.list(),
      queueLength: this.queue.length,
      feed: this.feed.slice(0, 10),
      leaderboard: this.players.leaderboard('session', 10),
      participants: this.players.participants(),
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
