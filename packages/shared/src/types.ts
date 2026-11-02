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

/** Vùng màn hình / tài nguyên mà hoạt ảnh chiếm. Hai hành động chung lane không chạy cùng lúc. */
export type Lane = 'boss' | 'desk' | 'car' | 'meeting' | 'toilet' | 'staff';
export const ALL_LANES: Lane[] = ['boss', 'desk', 'car', 'meeting', 'toilet', 'staff'];

export interface ActionTrigger {
  /** Các loại sự kiện (ngoài gift) có thể kích hoạt hành động này. Gift đi qua bảng GiftMapping. */
  kinds: Exclude<EventKind, 'gift' | 'join'>[];
  /** Từ khoá bình luận (so khớp không dấu, theo ranh giới từ). Chỉ áp dụng khi kinds có 'comment'. */
  keywords: string[];
  /**
   * Chỉ người đã follow (nhân viên chính thức) mới kích hoạt được bằng bình luận/like/share.
   * Quà tặng luôn kích hoạt được. Mặc định bật cho các hành động "trêu Sếp" để khuyến khích follow/tặng quà.
   */
  followersOnly?: boolean;
}

export interface BossEffect {
  /** Thay đổi độ bình tĩnh (thường âm). */
  calm: number;
  /** Thay đổi sức chịu đựng (thường âm). */
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
  bossEffect: BossEffect;
  /** Điểm đóng góp cho người kích hoạt. */
  points: number;
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

export interface BossConfig {
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
  boss: BossConfig;
  collective: CollectiveConfig;
  limits: EngineLimits;
  /** Công việc miễn phí cho người xem (gõ bình luận) — giữ chân người xem, không ảnh hưởng Sếp. */
  work: WorkTask[];
}

// ----------------------------------------------------------------------------
// Công việc (tương tác miễn phí)
// ----------------------------------------------------------------------------

export interface WorkTask {
  id: string;
  name: string;
  enabled: boolean;
  /** Từ khoá bình luận (so khớp không dấu, theo ranh giới từ). */
  keywords: string[];
  /** Biểu tượng hiện trên đầu nhân vật. */
  emoji: string;
  /** Câu nhân vật nói (ngắn). */
  text: string;
  points: number;
  /** Mỗi người làm lại công việc này sau ít nhất ngần này ms. */
  userCooldownMs: number;
}

/** Một người vừa làm một công việc — overlay cho nhân vật của họ diễn tại chỗ ngồi. */
export interface WorkEvent {
  platformId: string;
  displayName: string;
  taskId: string;
  emoji: string;
  text: string;
  at: number;
}

// ----------------------------------------------------------------------------
// Trạng thái
// ----------------------------------------------------------------------------

export type Mood = 'normal' | 'annoyed' | 'angry' | 'panic' | 'helpless';

export const MOOD_LABELS: Record<Mood, string> = {
  normal: 'Bình thường',
  annoyed: 'Khó chịu',
  angry: 'Tức giận',
  panic: 'Hoảng loạn',
  helpless: 'Bất lực'
};

export interface BossState {
  calm: number;
  stamina: number;
  mood: Mood;
  /** Mốc thời gian Sếp hết "bất lực" do cạn sức chịu đựng (0 = không). */
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

export interface PlayerTitle {
  id: 'diligent' | 'deadline_breaker' | 'rebel' | 'meeting_boss' | 'boss_enemy';
  label: string;
}

export interface LeaderboardEntry {
  rank: number;
  platformId: string;
  displayName: string;
  avatarUrl?: string;
  participations: number;
  points: number;
  /** Tổng kim cương đã tặng (trong phiên hoặc toàn thời gian, tuỳ bảng) — tiêu chí xếp hạng "phá Sếp" đầu tiên. */
  diamonds: number;
  title: string;
}

/** Người đang có mặt trong văn phòng (overlay xếp ghế theo danh sách này). */
export interface RosterMember {
  platformId: string;
  displayName: string;
  /** Đã follow → nhân viên chính thức; chưa → thực tập sinh. */
  follower: boolean;
  points: number;
}

export const ROSTER_MAX = 100;

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
  boss: BossState;
  runningActions: RunningAction[];
  queueLength: number;
  feed: FeedItem[];
  leaderboard: LeaderboardEntry[];
  participants: number;
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
  | { type: 'boss'; data: BossState }
  | { type: 'feed'; data: FeedItem[] }
  | { type: 'leaderboard'; data: { entries: LeaderboardEntry[]; participants: number } }
  | { type: 'roster'; data: RosterMember[] }
  | { type: 'work'; data: WorkEvent }
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
