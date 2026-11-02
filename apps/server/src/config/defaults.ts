import type { ActionConfig, BossConfig, CollectiveConfig, EngineLimits, GameConfig, GiftMapping, WorkTask } from '@sep/shared';

/**
 * Cấu hình mặc định — được seed vào DB lần đầu chạy.
 * Sau đó mọi thay đổi (bật/tắt, cooldown, từ khoá, mapping quà) chỉnh trên dashboard, không sửa code.
 *
 * "Trêu Sếp" CHỈ bằng quà tặng: mặc định các hành động không có trigger bình luận/like/share
 * (trigger.kinds = [], keywords = []) — quà được ánh xạ sang hành động theo giá trị kim cương (DEFAULT_GIFTS).
 * Bình luận dành cho các "công việc" miễn phí (DEFAULT_WORK) và góp sức sự kiện tập thể (Đình công).
 * Admin vẫn có thể bật lại trigger bình luận cho từng hành động trên dashboard nếu muốn.
 *
 * Danh sách hành động do code quy định (overlay chỉ có hoạt ảnh cho đúng các id này): mỗi lần khởi động,
 * store bổ sung hành động mặc định còn thiếu và xoá hành động không còn trong danh sách (xem `reconcileConfig`).
 * Hành động luôn chạy lần lượt từng cái một — cái trước xong mới tới cái sau.
 */
export const DEFAULT_ACTIONS: ActionConfig[] = [
  {
    id: 'throw_paper',
    name: 'Ném giấy vào Sếp',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 3000,
    cooldownMs: 4000,
    userCooldownMs: 15000,
    priority: 10,
    lanes: ['boss'],
    bossEffect: { calm: -4, stamina: -2 },
    points: 5
  },
  {
    id: 'pluck_tree',
    name: 'Vặt lá cây phát tài',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 7000,
    cooldownMs: 15000,
    userCooldownMs: 30000,
    priority: 15,
    lanes: ['boss'],
    bossEffect: { calm: -7, stamina: -3 },
    points: 10
  },
  {
    id: 'doodle_kpi',
    name: 'Vẽ bậy lên bảng KPI',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 7000,
    cooldownMs: 15000,
    userCooldownMs: 30000,
    priority: 15,
    lanes: ['boss'],
    bossEffect: { calm: -8, stamina: -3 },
    points: 10
  },
  {
    id: 'flat_tire',
    name: 'Xịt lốp xe Sếp',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 9000,
    cooldownMs: 25000,
    userCooldownMs: 40000,
    priority: 25,
    // Cảnh cắt ra bãi đỗ xe chiếm cả sân khấu nên giữ mọi lane của văn phòng.
    lanes: ['car', 'boss', 'desk', 'meeting', 'toilet'],
    bossEffect: { calm: -10, stamina: -5 },
    points: 12
  },
  {
    id: 'lock_toilet',
    name: 'Khóa nhà vệ sinh',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 8000,
    cooldownMs: 30000,
    userCooldownMs: 40000,
    priority: 25,
    lanes: ['boss', 'toilet'],
    bossEffect: { calm: -12, stamina: -8 },
    points: 12
  },
  {
    id: 'crash_pc',
    name: 'Làm treo máy tính Sếp',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 8000,
    cooldownMs: 20000,
    userCooldownMs: 35000,
    priority: 20,
    lanes: ['boss', 'desk'],
    bossEffect: { calm: -8, stamina: -4 },
    points: 10
  },
  {
    id: 'complaint_call',
    name: 'Khách gọi phàn nàn',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 6000,
    cooldownMs: 20000,
    userCooldownMs: 35000,
    priority: 20,
    lanes: ['boss'],
    bossEffect: { calm: -9, stamina: -3 },
    points: 10
  },
  {
    // Hành động "hồi máu": nịnh Sếp làm Sếp bình tĩnh lại một chút.
    id: 'praise_boss',
    name: 'Nịnh Sếp',
    enabled: true,
    trigger: { kinds: [], keywords: [] },
    durationMs: 5000,
    cooldownMs: 15000,
    userCooldownMs: 60000,
    priority: 10,
    lanes: ['boss'],
    bossEffect: { calm: 6, stamina: 2 },
    points: 3
  },
  {
    id: 'blackout',
    name: 'Ngắt cầu dao',
    enabled: true,
    trigger: { kinds: [], keywords: [], followersOnly: true },
    durationMs: 8000,
    cooldownMs: 25000,
    userCooldownMs: 40000,
    priority: 25,
    lanes: ['boss', 'desk'],
    bossEffect: { calm: -10, stamina: -6 },
    points: 12
  },
  {
    // Chỉ chạy khi sự kiện tập thể đạt mục tiêu (hoặc admin bấm thử).
    id: 'strike',
    name: 'Đình công toàn công ty',
    enabled: true,
    trigger: { kinds: [], keywords: [] },
    durationMs: 9000,
    cooldownMs: 0,
    userCooldownMs: 0,
    priority: 1000,
    lanes: ['boss', 'desk', 'car', 'meeting', 'toilet', 'staff'],
    bossEffect: { calm: -40, stamina: -30 },
    points: 0
  }
];

/**
 * Mapping quà mặc định — trêu Sếp theo GIÁ TRỊ quà (kim cương × số lượng sau khi gộp streak).
 * - Mapping có đúng giftId thắng trước (vd. 7934 = Heart Me → Nịnh Sếp: quà "tình cảm" thì nịnh, không phá).
 * - Còn lại đi theo các bậc giftId 0: chọn bậc có minDiamonds cao nhất ≤ tổng giá trị;
 *   không rõ giá trị thì lấy bậc thấp nhất. Quà càng to, trò càng nặng.
 * Gift ID khác xem trong Lịch sử sự kiện để thêm mapping riêng.
 */
export const DEFAULT_GIFTS: GiftMapping[] = [
  { giftId: 7934, giftName: 'Heart Me', actionId: 'praise_boss', minCount: 1, minDiamonds: 0, enabled: true },
  { giftId: 0, giftName: 'Từ 1 kim cương (Rose…)', actionId: 'throw_paper', minCount: 1, minDiamonds: 1, enabled: true },
  { giftId: 0, giftName: 'Từ 5 kim cương (Finger Heart…)', actionId: 'pluck_tree', minCount: 1, minDiamonds: 5, enabled: true },
  { giftId: 0, giftName: 'Từ 10 kim cương', actionId: 'doodle_kpi', minCount: 1, minDiamonds: 10, enabled: true },
  { giftId: 0, giftName: 'Từ 30 kim cương (Doughnut…)', actionId: 'complaint_call', minCount: 1, minDiamonds: 30, enabled: true },
  { giftId: 0, giftName: 'Từ 99 kim cương (Hat and Mustache…)', actionId: 'crash_pc', minCount: 1, minDiamonds: 99, enabled: true },
  { giftId: 0, giftName: 'Từ 199 kim cương', actionId: 'lock_toilet', minCount: 1, minDiamonds: 199, enabled: true },
  { giftId: 0, giftName: 'Từ 299 kim cương', actionId: 'flat_tire', minCount: 1, minDiamonds: 299, enabled: true },
  { giftId: 0, giftName: 'Từ 499 kim cương (Money Gun…)', actionId: 'blackout', minCount: 1, minDiamonds: 499, enabled: true }
];

export const DEFAULT_BOSS: BossConfig = {
  // Hồi chậm để thanh tụt thấy rõ khi bị trêu liên tục (hành động chạy lần lượt ~7 giây/lượt).
  calmRecoveryPerSec: 0.15,
  staminaRecoveryPerSec: 0.1,
  exhaustedMs: 12000
};

export const DEFAULT_COLLECTIVE: CollectiveConfig = {
  enabled: true,
  name: 'Đình công toàn công ty',
  description: 'Bình luận hoặc thực hiện hành động để góp sức. Đủ mục tiêu, cả văn phòng đồng loạt đình công!',
  goal: 100,
  durationMs: 0,
  restartDelayMs: 15000,
  actionId: 'strike',
  rewardTitle: 'Nhân viên chống đối'
};

export const DEFAULT_LIMITS: EngineLimits = {
  maxQueue: 20,
  /** Luôn 1: hành động chạy nối tiếp. Engine ép về 1 kể cả khi DB cũ lưu giá trị khác. */
  maxConcurrent: 1,
  queueMaxWaitMs: 45000,
  userBucketCapacity: 4,
  userBucketRefillPerSec: 0.5,
  globalBucketCapacity: 60,
  globalBucketRefillPerSec: 25
};

/**
 * Công việc miễn phí: ai cũng làm được bằng bình luận (kể cả thực tập sinh chưa follow).
 * Nhân vật diễn tại chỗ ngồi và được cộng điểm; không ảnh hưởng Sếp, không vào hàng đợi hoạt ảnh.
 */
export const DEFAULT_WORK: WorkTask[] = [
  { id: 'lam_viec', name: 'Làm việc', enabled: true, keywords: ['lam viec', 'go phim', 'work', 'chay deadline'], emoji: '⌨️', text: 'Đang chạy deadline...', points: 2, userCooldownMs: 20000 },
  { id: 'nop_bao_cao', name: 'Nộp báo cáo', enabled: true, keywords: ['nop bao cao', 'bao cao', 'report'], emoji: '📄', text: 'Báo cáo đây Sếp!', points: 3, userCooldownMs: 30000 },
  { id: 'tang_ca', name: 'Tăng ca', enabled: true, keywords: ['tang ca', 'ot', 'overtime'], emoji: '🌙', text: 'Tăng ca tới sáng!', points: 3, userCooldownMs: 30000 },
  { id: 'pha_ca_phe', name: 'Pha cà phê', enabled: true, keywords: ['pha ca phe', 'pha cafe', 'uong cafe', 'uong ca phe'], emoji: '☕', text: 'Nạp cà phê đã...', points: 1, userCooldownMs: 20000 },
  { id: 'xin_nghi', name: 'Xin nghỉ', enabled: true, keywords: ['xin nghi', 'nghi phep', 'em xin nghi'], emoji: '🙏', text: 'Sếp ơi em xin nghỉ!', points: 1, userCooldownMs: 30000 },
  { id: 'hop_nhom', name: 'Họp nhóm', enabled: true, keywords: ['hop nhom', 'meeting'], emoji: '💬', text: 'Họp nhóm 5 phút...', points: 2, userCooldownMs: 30000 }
];

/**
 * Phiên bản cấu hình hiện tại. Tăng số này khi đổi mặc định theo kiểu cần nâng cấp cấu hình đã lưu
 * (thêm bước tương ứng trong `upgradeConfig`).
 * - 1: bản đầu (trêu Sếp bằng bình luận số 1–9 / từ khoá; một mapping giftId 0 → pluck_tree).
 * - 2: trêu Sếp chỉ bằng quà, ánh xạ quà theo bậc kim cương (minDiamonds).
 */
export const CONFIG_VERSION = 2;

export function defaultGameConfig(): GameConfig {
  return structuredClone({
    version: CONFIG_VERSION,
    actions: DEFAULT_ACTIONS,
    gifts: DEFAULT_GIFTS,
    boss: DEFAULT_BOSS,
    collective: DEFAULT_COLLECTIVE,
    limits: DEFAULT_LIMITS,
    work: DEFAULT_WORK
  });
}

/** Mapping quà trỏ tới hành động đã bị bỏ sẽ được chuyển sang hành động này. */
export const FALLBACK_GIFT_ACTION_ID = 'pluck_tree';

export interface ReconcileResult {
  config: GameConfig;
  added: string[];
  removed: string[];
  remappedGifts: number;
  /** Phiên bản cũ đã được nâng cấp (undefined = không cần nâng cấp). */
  upgradedFrom?: number;
  changed: boolean;
}

/** Mapping quà mặc định của bản 1 — bị thay bằng các bậc kim cương khi nâng cấp. */
const V1_DEFAULT_GIFTS: Pick<GiftMapping, 'giftId' | 'actionId' | 'minCount'>[] = [
  { giftId: 5655, actionId: 'throw_paper', minCount: 1 },
  { giftId: 5655, actionId: 'flat_tire', minCount: 10 }
];

/**
 * Nâng cấp cấu hình đã lưu lên CONFIG_VERSION — chỉ chạy khi `version` đã lưu thấp hơn (thiếu = 1),
 * nên chỉnh sửa của admin SAU khi nâng cấp được giữ nguyên ở các lần khởi động sau.
 *
 * 1 → 2 (trêu Sếp chỉ bằng quà):
 * - hành động có trigger mặc định rỗng (các trò trêu Sếp, Đình công) → bỏ trigger bình luận/like/share/từ khoá cũ;
 * - bỏ mapping quà mặc định cũ (mọi bậc giftId 0 và Rose / Rose x10) rồi thêm các bậc kim cương mới;
 *   mapping quà riêng admin tự thêm được giữ, mapping mặc định có giftId trùng với cái admin đã có thì bỏ qua.
 */
function upgradeConfig(cfg: GameConfig, defaults: GameConfig): GameConfig {
  const from = cfg.version ?? 1;
  let out = cfg;
  if (from < 2) {
    const defaultTrigger = new Map(defaults.actions.map((a) => [a.id, a.trigger]));
    const actions = out.actions.map((a) => {
      const t = defaultTrigger.get(a.id);
      if (!t || t.kinds.length > 0) return a;
      return { ...a, trigger: { ...a.trigger, kinds: [], keywords: [] } };
    });
    const kept = out.gifts.filter(
      (g) =>
        g.giftId !== 0 &&
        !V1_DEFAULT_GIFTS.some((d) => d.giftId === g.giftId && d.actionId === g.actionId && d.minCount === g.minCount)
    );
    const keptIds = new Set(kept.map((g) => g.giftId));
    const fresh = defaults.gifts.filter((g) => g.giftId === 0 || !keptIds.has(g.giftId)).map((g) => ({ ...g }));
    out = { ...out, actions, gifts: [...kept, ...fresh] };
  }
  return { ...out, version: Math.max(from, defaults.version ?? CONFIG_VERSION) };
}

/**
 * Đồng bộ cấu hình đã lưu với danh sách hành động trong code (overlay chỉ có hoạt ảnh cho các id mặc định):
 * - nâng cấp cấu hình phiên bản cũ một lần (`upgradeConfig`);
 * - thêm hành động mặc định còn thiếu (giữ nguyên chỉnh sửa của admin với hành động đã có);
 * - xoá hành động không còn trong `defaults.actions` (vd. `emergency_meeting`, `spill_coffee` bản cũ);
 * - sắp xếp hành động theo thứ tự mặc định;
 * - mapping quà trỏ tới hành động bị xoá → chuyển sang `FALLBACK_GIFT_ACTION_ID` (không mất mapping của admin);
 * - ép `limits.maxConcurrent = 1` (hành động chạy nối tiếp).
 */
export function reconcileConfig(stored: GameConfig, defaults: GameConfig): ReconcileResult {
  const order = new Map(defaults.actions.map((a, i) => [a.id, i]));
  const storedIds = new Set(stored.actions.map((a) => a.id));
  const removed = stored.actions.filter((a) => !order.has(a.id)).map((a) => a.id);
  const added = defaults.actions.filter((a) => !storedIds.has(a.id)).map((a) => a.id);

  const actions = [
    ...stored.actions.filter((a) => order.has(a.id)),
    ...defaults.actions.filter((a) => !storedIds.has(a.id)).map((a) => structuredClone(a))
  ].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const sortChanged = actions.some((a, i) => stored.actions[i]?.id !== a.id) || actions.length !== stored.actions.length;

  const fallback = order.has(FALLBACK_GIFT_ACTION_ID) ? FALLBACK_GIFT_ACTION_ID : defaults.actions[0]?.id;
  let remappedGifts = 0;
  const gifts = stored.gifts.flatMap((g) => {
    if (order.has(g.actionId)) return [g];
    if (!fallback) return [];
    remappedGifts += 1;
    return [{ ...g, actionId: fallback }];
  });

  const limits = stored.limits ? { ...stored.limits, maxConcurrent: 1 } : stored.limits;
  const limitsChanged = stored.limits?.maxConcurrent !== 1;

  const storedVersion = stored.version ?? 1;
  const target = defaults.version ?? CONFIG_VERSION;
  const needsUpgrade = storedVersion < target;
  const config = needsUpgrade
    ? upgradeConfig({ ...stored, actions, gifts, limits }, defaults)
    : { ...stored, actions, gifts, limits };

  return {
    config,
    added,
    removed,
    remappedGifts,
    upgradedFrom: needsUpgrade ? storedVersion : undefined,
    changed: sortChanged || remappedGifts > 0 || limitsChanged || needsUpgrade
  };
}
