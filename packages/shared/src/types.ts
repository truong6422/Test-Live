// ============================================================================
// Kiểu dữ liệu dùng chung giữa server, overlay và admin.
// ============================================================================

/** Loại sự kiện LIVE sau khi chuẩn hoá. */
export type EventKind = 'join' | 'comment' | 'gift' | 'like' | 'share' | 'follow';

/**
 * Nguồn sự kiện.
 * - tiktok: nhận thật từ TikTok LIVE connector.
 * - demo:   do chế độ demo sinh ra (luôn được gắn nhãn DEMO trên overlay).
 * - manual: admin bấm "Test hành động" trên dashboard.
 */
export type EventSource = 'tiktok' | 'demo' | 'manual';

export interface LiveUser {
  /** ID ổn định của nền tảng (TikTok userId). */
  platformId: string;
  /** @username (uniqueId). */
  username: string;
  displayName: string;
  avatarUrl?: string;
  /** Đã follow kênh (true/false nếu TikTok cho biết; undefined = chưa rõ). */
  follower?: boolean;
}

export interface GiftPayload {
  giftId: number;
  name: string;
  /** Số lượng sau khi đã gộp streak. */
  count: number;
  /** Giá trị kim cương của MỘT món quà (0 nếu nền tảng không cung cấp). */
  diamonds: number;
}

export interface NormalizedEvent {
  /** ID duy nhất để chống xử lý trùng (msgId của TikTok, hoặc demo:<uuid>). */
  id: string;
  source: EventSource;
  kind: EventKind;
  user: LiveUser;
  receivedAt: number;
  text?: string;
  gift?: GiftPayload;
  likeCount?: number;
}

// ----------------------------------------------------------------------------
// Hành động & cấu hình
// ----------------------------------------------------------------------------

/**
 * Vùng màn hình / tài nguyên mà hoạt ảnh chiếm. Hai hành động chung lane không chạy cùng lúc.
 * - king:       Cá Thần (con boss sống giữa hồ)
 * - lake:       mặt hồ
 * - dock:       các bến câu (nơi cần thủ ngồi)
 * - sky:        bầu trời / thời tiết
 * - underwater: cảnh cắt xuống đáy hồ (chiếm cả sân khấu)
 * - anglers:    toàn bộ cần thủ
 */
export type Lane = 'king' | 'lake' | 'dock' | 'sky' | 'underwater' | 'anglers';
export const ALL_LANES: Lane[] = ['king', 'lake', 'dock', 'sky', 'underwater', 'anglers'];

export interface ActionTrigger {
  /** Các loại sự kiện (ngoài gift) có thể kích hoạt hành động này. Gift đi qua bảng GiftMapping. */
  kinds: Exclude<EventKind, 'gift' | 'join'>[];
  /** Từ khoá bình luận (so khớp không dấu, theo ranh giới từ). Chỉ áp dụng khi kinds có 'comment'. */
  keywords: string[];
  /**
   * Chỉ người đã follow (cần thủ chính thức) mới kích hoạt được bằng bình luận/like/share.
   * Quà tặng luôn kích hoạt được.
   */
  followersOnly?: boolean;
}

/** Tác động của một hành động lên Cá Thần. */
export interface KingEffect {
  /** Thay đổi độ bình thản (âm = Cá Thần bị chọc, quẫy mạnh hơn; dương = dịu lại). */
  calm: number;
  /** Thay đổi sức bền (âm = Cá Thần đuối sức; về 0 thì kiệt sức, nổi lên mặt nước). */
  stamina: number;
}

export interface ActionConfig {
  id: string;
  name: string;
  enabled: boolean;
  trigger: ActionTrigger;
  durationMs: number;
  /** Hồi chiêu toàn cục của hành động. */
  cooldownMs: number;
  /** Hồi chiêu theo từng người xem. */
  userCooldownMs: number;
  /** Số càng lớn càng ưu tiên. */
  priority: number;
  lanes: Lane[];
  kingEffect: KingEffect;
  /** Điểm đóng góp cho người kích hoạt. */
  points: number;
  /** Hành động "kéo cá to": loài cá và khoảng cân. Server bốc cân rồi gửi trong RunningAction.fish. */
  fish?: BigFish;
}

/** Một loài cá to (kéo bằng quà hoặc sự kiện cá to định kỳ). */
export interface BigFish {
  emoji: string;
  name: string;
  minKg: number;
  maxKg: number;
}

/** Cấu hình câu tự động. */
export interface FishingConfig {
  /**
   * Cứ mỗi chu kỳ này (mặc định 5000) có `catchesPerTick` con cá thường cắn câu,
   * LẦN LƯỢT theo thứ tự người vào hồ (xoay vòng: hết lượt người cuối thì quay lại người đầu).
   */
  tickMs: number;
  /** Số cá thường lên mỗi chu kỳ (mặc định 1). */
  catchesPerTick: number;
  /** Bảng cá thường; loài + cân bốc ngẫu nhiên cho người tới lượt. */
  loot: LootItem[];
  /**
   * Cứ chừng này ms lại có "cá to xuất hiện" (0 = tắt): trước đó `bigFishShadowMs` overlay cho bóng cá to
   * bơi dưới hồ (tính từ `nextBigFishAt`), tới giờ thì cá cắn câu một người đang ngồi chọn NGẪU NHIÊN đều.
   */
  bigFishEveryMs: number;
  /** Bóng cá to hiện trước bao lâu (mặc định 15000). */
  bigFishShadowMs: number;
  /** Hành động chạy khi cá to định kỳ xuất hiện. */
  bigFishActionId: string;
  /** Số ghế "chiếu giữa" trước mặt hồ dành cho người tặng quà nhiều / câu lâu nhất. */
  frontSeats: number;
  /** Không bình luận/tặng quà quá lâu thì rời hồ (0 = không bao giờ). */
  idleKickMs: number;
}

export interface GiftMapping {
  /** 0 = mọi quà chưa được map riêng. */
  giftId: number;
  giftName: string;
  actionId: string;
  /** Số lượng tối thiểu (sau khi gộp streak) để kích hoạt. */
  minCount: number;
  /**
   * Mốc giá trị tối thiểu (kim cương). Tổng giá trị = kim cương của MỘT món × số lượng sau khi gộp streak.
   * Dùng cho các bậc giftId 0: chọn bậc có minDiamonds cao nhất mà vẫn ≤ tổng giá trị. Bỏ trống = 0.
   */
  minDiamonds?: number;
  enabled: boolean;
}

export interface KingConfig {
  calmRecoveryPerSec: number;
  staminaRecoveryPerSec: number;
  exhaustedMs: number;
}

export interface CollectiveConfig {
  enabled: boolean;
  name: string;
  description: string;
  goal: number;
  /** Thời lượng tối đa của một vòng (0 = không giới hạn). */
  durationMs: number;
  /** Nghỉ bao lâu trước khi mở vòng mới. */
  restartDelayMs: number;
  /** Hành động chạy khi đạt mục tiêu. */
  actionId: string;
  rewardTitle: string;
}

export interface EngineLimits {
  maxQueue: number;
  maxConcurrent: number;
  /** Hành động chờ quá lâu trong hàng đợi sẽ bị bỏ. */
  queueMaxWaitMs: number;
  userBucketCapacity: number;
  userBucketRefillPerSec: number;
  globalBucketCapacity: number;
  globalBucketRefillPerSec: number;
}

export interface GameConfig {
  /**
   * Phiên bản cấu hình đã lưu (thiếu = 1, bản cũ). Khi khởi động, cấu hình có phiên bản thấp hơn bản hiện tại
   * được nâng cấp MỘT lần (xem `reconcileConfig` ở server); sau đó chỉnh sửa của admin được giữ nguyên.
   */
  version?: number;
  actions: ActionConfig[];
  gifts: GiftMapping[];
  king: KingConfig;
  fishing: FishingConfig;
  collective: CollectiveConfig;
  limits: EngineLimits;
  /** Việc câu miễn phí cho người xem (gõ bình luận) — giữ chân người xem, không ảnh hưởng Cá Thần. */
  work: WorkTask[];
  /**
   * Từ tục / xúc phạm bị che (dấu sao) trong tên và bình luận trước khi lên overlay.
   * So khớp theo TỪ, chữ thường, giữ dấu. Lưu trong bảng settings (khoá `blocklist`), sửa ở tab "Bộ lọc từ".
   */
  blocklist: string[];
}

// ----------------------------------------------------------------------------
// Việc câu (tương tác miễn phí bằng bình luận)
// ----------------------------------------------------------------------------

/** Một loại "chiến lợi phẩm" có thể câu được khi làm việc có `loot`. */
export interface LootItem {
  emoji: string;
  /** Tên hiển thị, ví dụ "Cá rô", "Chiếc ủng rách". */
  name: string;
  /** Trọng số rơi (càng lớn càng dễ ra). */
  weight: number;
  /** Cân nặng ngẫu nhiên trong khoảng [minKg, maxKg] (0–0 = rác, không tính cân). */
  minKg: number;
  maxKg: number;
  /** Điểm thưởng cộng thêm vào `WorkTask.points`. */
  points: number;
}

export interface WorkTask {
  id: string;
  name: string;
  enabled: boolean;
  /** Từ khoá bình luận (so khớp không dấu, theo ranh giới từ). */
  keywords: string[];
  /** Biểu tượng hiện trên đầu nhân vật (khi không có loot). */
  emoji: string;
  /** Câu nhân vật nói (ngắn). Với loot: "{name}" và "{kg}" được thay bằng tên / cân nặng món câu được. */
  text: string;
  points: number;
  /** Mỗi người làm lại việc này sau ít nhất ngần này ms. */
  userCooldownMs: number;
  /** Có loot → mỗi lần làm, server bốc ngẫu nhiên 1 món theo trọng số (vd. việc "Câu cá"). */
  loot?: LootItem[];
}

/** Một người vừa làm một việc — overlay cho cần thủ của họ diễn tại chỗ (giật cần, kéo cá lên…). */
export interface WorkEvent {
  platformId: string;
  displayName: string;
  taskId: string;
  emoji: string;
  text: string;
  at: number;
  /** Điểm thực nhận (points + loot.points). */
  points: number;
  /** Có khi việc có loot: món câu được. kg = 0 với rác. */
  catch?: { emoji: string; name: string; kg: number };
}

/**
 * Bình luận thường của người xem (không khớp hành động / việc vui) → bong bóng chat trên đầu cần thủ.
 * text đã qua bộ lọc từ (maskBlocked) ở normalizer.
 */
export interface ChatEvent {
  platformId: string;
  displayName: string;
  text: string;
  at: number;
}

// ----------------------------------------------------------------------------
// Trạng thái
// ----------------------------------------------------------------------------

/** Trạng thái Cá Thần. */
export type Mood = 'calm' | 'curious' | 'agitated' | 'thrashing' | 'exhausted';

export const MOOD_LABELS: Record<Mood, string> = {
  calm: 'Lững lờ',
  curious: 'Tò mò',
  agitated: 'Cáu kỉnh',
  thrashing: 'Quẫy dữ dội',
  exhausted: 'Kiệt sức'
};

export interface KingState {
  /** 0..100 — độ bình thản. */
  calm: number;
  /** 0..100 — sức bền; về 0 thì kiệt sức (nổi lên mặt nước) trong `exhaustedMs`. */
  stamina: number;
  mood: Mood;
  /** Mốc thời gian Cá Thần hết kiệt sức (0 = không). */
  exhaustedUntil: number;
  lastActionId: string | null;
  lastActorName: string | null;
}

export interface RunningAction {
  runId: string;
  actionId: string;
  actionName: string;
  lanes: Lane[];
  actor: { displayName: string; avatarUrl?: string } | null;
  source: EventSource | 'collective';
  startedAt: number;
  durationMs: number;
  /** Cá to được kéo lên trong hoạt ảnh này (cân đã chốt ở server). */
  fish?: { emoji: string; name: string; kg: number };
}

/** Một con cá lên trong chu kỳ câu tự động. Server gửi gộp mỗi chu kỳ: { type: 'catches' }. */
export interface CatchEvent {
  platformId: string;
  displayName: string;
  emoji: string;
  name: string;
  /** 0 = rác. */
  kg: number;
  at: number;
}

export type EventOutcome =
  | 'accepted'
  | 'participated'
  | 'deduped'
  | 'rate_limited'
  | 'cooldown'
  | 'disabled'
  | 'dropped'
  | 'expired'
  | 'game_stopped'
  | 'filtered'
  /** Làm một "công việc" (WorkTask). */
  | 'work';

export interface FeedItem {
  id: string;
  at: number;
  source: EventSource | 'collective';
  actorName: string;
  actorAvatar?: string;
  actionId: string | null;
  text: string;
}

/**
 * Danh hiệu cần thủ:
 * - rookie: Cần thủ tập sự (mặc định)
 * - angler: Cần thủ chăm chỉ (câu nhiều)
 * - big_catch: Sát thủ cá to (từng câu được cá nặng)
 * - troll: Kẻ phá hồ (tặng quà quậy nhiều)
 * - king_hunter: Kẻ săn Cá Thần (góp sức kéo Cá Thần)
 */
export interface PlayerTitle {
  id: 'rookie' | 'angler' | 'big_catch' | 'troll' | 'king_hunter';
  label: string;
}

export interface LeaderboardEntry {
  rank: number;
  platformId: string;
  displayName: string;
  avatarUrl?: string;
  participations: number;
  points: number;
  /** Tổng kim cương đã tặng (trong phiên hoặc toàn thời gian, tuỳ bảng) — tiêu chí xếp hạng "TOP CẦN THỦ" đầu tiên. */
  diamonds: number;
  /** Tổng cân cá đã câu (kg) — bảng "BẢNG CÂN CÁ" xếp theo trường này. */
  kg: number;
  title: string;
}

/** Người đang ngồi câu quanh hồ (overlay xếp chỗ trên các bến theo danh sách này). */
export interface RosterMember {
  platformId: string;
  displayName: string;
  /** Đã follow → cần thủ chính thức (đội nón); chưa → cần thủ tập sự. */
  follower: boolean;
  points: number;
  /** 'front' = chiếu giữa trước mặt hồ (top quà / câu lâu), 'left' | 'right' = hai bên bờ. Server quyết định. */
  seat: 'front' | 'left' | 'right';
  /** Tổng cân cá đã câu trong phiên (kg, 1 chữ số thập phân). */
  kg: number;
  /** Đã ngồi câu bao lâu trong phiên (ms). */
  fishingMs: number;
  /** Kim cương đã tặng trong phiên. */
  diamonds: number;
}

export const ROSTER_MAX = 50;

/** Hồ câu cho admin (GET /api/lake): người đang ngồi + ai tới lượt cá thường cắn câu kế tiếp. */
export interface LakeState {
  roster: RosterMember[];
  /** Người sẽ được cá thường ở chu kỳ tới (null = hồ trống). */
  nextTurnId: string | null;
  capacity: number;
}

/** Thống kê phiên LIVE hiện tại (GET /api/stats). Chỉ trong bộ nhớ: khởi động lại server thì về 0. */
export interface SessionStats {
  /** Tổng thời gian game đang chạy trong phiên (ms) — mẫu số cho "cá / phút". */
  activeMs: number;
  /** Số cá (kg > 0) lên trong phiên: cá thường + cá to. */
  fishCaught: number;
  /** Số món rác (kg = 0). */
  junkCaught: number;
  /** Số lần kéo cá to (quà, định kỳ, tập thể). */
  bigFishPulled: number;
  /** Tổng cân cá (kg, 1 chữ số thập phân). */
  totalKg: number;
  /** Số lượt tặng quà nhận được (mỗi sự kiện quà đã gộp combo tính 1). */
  giftsReceived: number;
  /** Tổng kim cương nhận được. */
  giftDiamonds: number;
  /** Con cá nặng nhất phiên. */
  biggest: { displayName: string; emoji: string; name: string; kg: number; at: number } | null;
  queueLength: number;
}

export interface CollectiveState {
  roundId: string;
  name: string;
  description: string;
  goal: number;
  progress: number;
  participants: number;
  status: 'active' | 'completed' | 'expired' | 'idle';
  startedAt: number;
  endsAt: number | null;
}

export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error';

export interface ConnectorInfo {
  tiktok: {
    status: ConnectorStatus;
    username: string | null;
    roomId: string | null;
    viewerCount: number;
    lastError: string | null;
    reconnectAttempt: number;
  };
  demo: { running: boolean };
}

export interface GameSnapshot {
  running: boolean;
  sessionId: string | null;
  king: KingState;
  runningActions: RunningAction[];
  queueLength: number;
  feed: FeedItem[];
  /** TOP QUÀ TẶNG: theo kim cương. */
  leaderboard: LeaderboardEntry[];
  /** BẢNG CÂN CÁ: theo kg. */
  kgBoard: LeaderboardEntry[];
  participants: number;
  /** Mốc dự kiến cá to định kỳ xuất hiện (0 = tắt). */
  nextBigFishAt: number;
  /** Bóng cá to hiện trước nextBigFishAt bao lâu (ms). */
  bigFishShadowMs: number;
  roster: RosterMember[];
  collective: CollectiveState | null;
  connectors: ConnectorInfo;
  serverTime: number;
}

// ----------------------------------------------------------------------------
// Tin nhắn WebSocket server -> client
// ----------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'snapshot'; data: GameSnapshot }
  | { type: 'action.started'; data: RunningAction }
  | { type: 'action.ended'; data: { runId: string; actionId: string } }
  | { type: 'king'; data: KingState }
  | { type: 'feed'; data: FeedItem[] }
  | { type: 'leaderboard'; data: { entries: LeaderboardEntry[]; kgBoard: LeaderboardEntry[]; participants: number } }
  | { type: 'catches'; data: CatchEvent[] }
  | { type: 'bigfish.next'; data: { at: number; shadowMs: number } }
  | { type: 'roster'; data: RosterMember[] }
  | { type: 'work'; data: WorkEvent }
  | { type: 'chat'; data: ChatEvent }
  | { type: 'collective'; data: CollectiveState | null }
  | { type: 'connectors'; data: ConnectorInfo }
  | { type: 'game'; data: { running: boolean; sessionId: string | null } }
  | { type: 'history'; data: HistoryEntry }
  | { type: 'queue'; data: { length: number } };

export interface HistoryEntry {
  id: string;
  sessionId: string | null;
  eventId: string;
  source: EventSource | 'collective';
  kind: EventKind | 'collective';
  playerId: string | null;
  actorName: string;
  actionId: string | null;
  outcome: EventOutcome;
  summary: string;
  createdAt: number;
}
