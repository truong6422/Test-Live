import {
  ALL_LANES,
  type ActionConfig,
  type BigFish,
  type CollectiveConfig,
  type EngineLimits,
  type FishingConfig,
  type GameConfig,
  type GiftMapping,
  type KingConfig,
  type LootItem,
  type WorkTask
} from '@cau/shared';
import { DEFAULT_BLOCKLIST } from '../normalizer/sanitize';

/**
 * Cấu hình mặc định của "ĐI CÂU THÔI!" — được seed vào DB lần đầu chạy.
 * Sau đó mọi thay đổi (bật/tắt, mapping quà, câu tự động, việc vui) chỉnh trên dashboard, không sửa code.
 *
 * Luật chính:
 * - Bình luận / tặng quà bất kỳ → vào hồ ngồi câu; mỗi `fishing.tickMs` có `catchesPerTick` con cá (`fishing.loot`)
 *   cắn câu lần lượt theo thứ tự vào hồ (xoay vòng).
 * - Tặng quà → kéo cá to ngay (hành động `pull_*` theo bậc kim cương, DEFAULT_GIFTS); cân cá cộng cho người tặng.
 * - Định kỳ `fishing.bigFishEveryMs` → "Cá to xuất hiện!" cho một người đang ngồi (`big_fish_event`).
 * - Sự kiện tập thể đủ mục tiêu → `grand_haul`, cân Cá Thần chia đều cho người góp sức.
 * Mặc định các hành động không có trigger bình luận/like/share (trigger.kinds = [], keywords = []).
 *
 * Danh sách hành động do code quy định (overlay chỉ có hoạt ảnh cho đúng các id này): mỗi lần khởi động,
 * store bổ sung hành động mặc định còn thiếu và xoá hành động không còn trong danh sách (xem `reconcileConfig`).
 * Hành động luôn chạy lần lượt từng cái một — cái trước xong mới tới cái sau.
 */
const pull = (
  id: string,
  name: string,
  fish: BigFish,
  durationMs: number,
  points: number,
  priority: number,
  kingEffect: ActionConfig['kingEffect'],
  allLanes = false,
  followersOnly = true
): ActionConfig => ({
  id,
  name,
  enabled: true,
  trigger: followersOnly ? { kinds: [], keywords: [], followersOnly: true } : { kinds: [], keywords: [] },
  durationMs,
  cooldownMs: 0,
  userCooldownMs: 0,
  priority,
  lanes: allLanes ? [...ALL_LANES] : ['king', 'lake'],
  kingEffect,
  points,
  fish
});

export const DEFAULT_ACTIONS: ActionConfig[] = [
  pull('pull_carp', 'Kéo cá chép to', { emoji: '🐟', name: 'Cá chép to', minKg: 3, maxKg: 6 }, 5000, 5, 10, { calm: -3, stamina: -1 }),
  pull('pull_grass_carp', 'Kéo cá trắm cỏ', { emoji: '🐠', name: 'Cá trắm cỏ', minKg: 6, maxKg: 12 }, 6000, 10, 15, { calm: -5, stamina: -2 }),
  pull('pull_catfish', 'Kéo cá trê khổng lồ', { emoji: '🐡', name: 'Cá trê khổng lồ', minKg: 10, maxKg: 20 }, 7000, 10, 15, { calm: -6, stamina: -3 }),
  pull('pull_snakehead', 'Kéo cá lóc bông', { emoji: '🐟', name: 'Cá lóc bông', minKg: 15, maxKg: 25 }, 7000, 12, 20, { calm: -7, stamina: -3 }),
  pull('pull_giant_catfish', 'Kéo cá lăng khủng', { emoji: '🦈', name: 'Cá lăng khủng', minKg: 25, maxKg: 50 }, 8000, 15, 20, { calm: -8, stamina: -4 }),
  pull('pull_arowana', 'Kéo cá rồng vàng', { emoji: '🐉', name: 'Cá rồng vàng', minKg: 40, maxKg: 70 }, 9000, 20, 25, { calm: -10, stamina: -6 }),
  pull('pull_stingray', 'Kéo cá đuối nước ngọt', { emoji: '🦈', name: 'Cá đuối khổng lồ', minKg: 60, maxKg: 120 }, 10000, 25, 25, { calm: -12, stamina: -8 }, true),
  pull('pull_legend', 'Kéo Cá Thần huyền thoại', { emoji: '👑', name: 'Cá Thần huyền thoại', minKg: 150, maxKg: 300 }, 12000, 40, 30, { calm: -15, stamina: -10 }, true),
  // Quà "tình cảm" (Heart Me): cá Koi — Cá Thần dịu lại một chút.
  pull('pull_koi', 'Kéo cá Koi', { emoji: '🎏', name: 'Cá Koi đỏ trắng', minKg: 2, maxKg: 5 }, 5000, 3, 10, { calm: 6, stamina: 2 }, false, false),
  // Cá to định kỳ cho một người đang ngồi câu (không cần quà).
  pull('big_fish_event', 'Cá to xuất hiện!', { emoji: '🐋', name: 'Cá to bí ẩn', minKg: 8, maxKg: 30 }, 8000, 10, 50, { calm: -5, stamina: -2 }, false, false),
  // Chỉ chạy khi sự kiện tập thể đạt mục tiêu (hoặc admin bấm thử). Cân chia đều cho người góp sức.
  pull('grand_haul', 'Cả hồ kéo Cá Thần', { emoji: '👑', name: 'Cá Thần', minKg: 200, maxKg: 400 }, 12000, 0, 1000, { calm: -40, stamina: -30 }, true, false)
];

/**
 * Mapping quà mặc định — kéo cá to theo GIÁ TRỊ quà (kim cương × số lượng sau khi gộp streak).
 * - Mapping có đúng giftId thắng trước (7934 = Heart Me → cá Koi).
 * - Còn lại đi theo các bậc giftId 0: chọn bậc có minDiamonds cao nhất ≤ tổng giá trị;
 *   không rõ giá trị thì lấy bậc thấp nhất. Quà càng to, cá càng to.
 * Gift ID khác xem trong Lịch sử sự kiện để thêm mapping riêng.
 */
export const DEFAULT_GIFTS: GiftMapping[] = [
  { giftId: 7934, giftName: 'Heart Me', actionId: 'pull_koi', minCount: 1, minDiamonds: 0, enabled: true },
  { giftId: 0, giftName: 'Từ 1 kim cương (Rose…)', actionId: 'pull_carp', minCount: 1, minDiamonds: 1, enabled: true },
  { giftId: 0, giftName: 'Từ 5 kim cương (Finger Heart…)', actionId: 'pull_grass_carp', minCount: 1, minDiamonds: 5, enabled: true },
  { giftId: 0, giftName: 'Từ 10 kim cương', actionId: 'pull_catfish', minCount: 1, minDiamonds: 10, enabled: true },
  { giftId: 0, giftName: 'Từ 30 kim cương (Doughnut…)', actionId: 'pull_snakehead', minCount: 1, minDiamonds: 30, enabled: true },
  { giftId: 0, giftName: 'Từ 99 kim cương (Hat and Mustache…)', actionId: 'pull_giant_catfish', minCount: 1, minDiamonds: 99, enabled: true },
  { giftId: 0, giftName: 'Từ 199 kim cương', actionId: 'pull_arowana', minCount: 1, minDiamonds: 199, enabled: true },
  { giftId: 0, giftName: 'Từ 299 kim cương', actionId: 'pull_stingray', minCount: 1, minDiamonds: 299, enabled: true },
  { giftId: 0, giftName: 'Từ 499 kim cương (Money Gun…)', actionId: 'pull_legend', minCount: 1, minDiamonds: 499, enabled: true }
];

export const DEFAULT_KING: KingConfig = {
  calmRecoveryPerSec: 0.15,
  staminaRecoveryPerSec: 0.1,
  exhaustedMs: 12000
};

/** Bảng cá thường cho câu tự động: trọng số rơi, khoảng cân (kg), điểm thưởng. */
export const DEFAULT_LOOT: LootItem[] = [
  { emoji: '🐟', name: 'Cá rô', weight: 30, minKg: 0.1, maxKg: 0.5, points: 0 },
  { emoji: '🐠', name: 'Cá chép', weight: 22, minKg: 0.5, maxKg: 3, points: 1 },
  { emoji: '🐡', name: 'Cá trắm', weight: 12, minKg: 2, maxKg: 8, points: 3 },
  { emoji: '🦐', name: 'Tôm càng', weight: 12, minKg: 0.05, maxKg: 0.2, points: 1 },
  { emoji: '🐢', name: 'Rùa (thả lại)', weight: 4, minKg: 1, maxKg: 5, points: 2 },
  { emoji: '🥾', name: 'Chiếc ủng rách', weight: 10, minKg: 0, maxKg: 0, points: 0 },
  { emoji: '🧦', name: 'Chiếc tất thối', weight: 6, minKg: 0, maxKg: 0, points: 0 },
  { emoji: '🦈', name: 'Cá lăng khủng', weight: 3, minKg: 10, maxKg: 30, points: 10 },
  { emoji: '👑', name: 'Cá Koi vàng', weight: 1, minKg: 3, maxKg: 6, points: 25 }
];

export const DEFAULT_FISHING: FishingConfig = {
  tickMs: 5000,
  catchesPerTick: 1,
  loot: DEFAULT_LOOT,
  bigFishEveryMs: 180_000,
  bigFishShadowMs: 15_000,
  bigFishActionId: 'big_fish_event',
  frontSeats: 5,
  idleKickMs: 600_000
};

export const DEFAULT_COLLECTIVE: CollectiveConfig = {
  enabled: true,
  name: 'Cả hồ kéo Cá Thần',
  description: 'Bình luận hoặc tặng quà để góp sức. Đủ mục tiêu, mọi cần thủ cùng kéo Cá Thần lên bờ và chia nhau cân cá!',
  goal: 100,
  durationMs: 0,
  restartDelayMs: 15000,
  actionId: 'grand_haul',
  rewardTitle: 'Kẻ săn Cá Thần'
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
 * Việc vui bằng bình luận (biểu cảm): cần thủ diễn tại chỗ và được cộng điểm.
 * Không ảnh hưởng Cá Thần, không vào hàng đợi hoạt ảnh. Câu cá là tự động (xem DEFAULT_FISHING).
 */
export const DEFAULT_WORK: WorkTask[] = [
  { id: 'thay_moi', name: 'Thay mồi', enabled: true, keywords: ['thay moi', 'moc moi', 'moi'], emoji: '🪱', text: 'Mồi giun xịn đây!', points: 1, userCooldownMs: 20000 },
  { id: 'uong_tra', name: 'Uống trà đá', enabled: true, keywords: ['tra da', 'uong tra', 'nghi'], emoji: '🍵', text: 'Làm cốc trà đá đã...', points: 1, userCooldownMs: 20000 },
  { id: 'khoe_ca', name: 'Khoe cá', enabled: true, keywords: ['khoe', 'song ao', 'check in'], emoji: '📸', text: 'Cá to chưa anh em!', points: 2, userCooldownMs: 20000 },
  { id: 'hat_ho', name: 'Hát hò', enabled: true, keywords: ['hat', 'hat ho', 'ca hat'], emoji: '🎵', text: 'Ơi à ơi... cá ơi lên đi!', points: 1, userCooldownMs: 20000 },
  { id: 'ngu_gat', name: 'Ngủ gật', enabled: true, keywords: ['ngu', 'buon ngu', 'ngu gat'], emoji: '😴', text: 'Zzz... cá cắn câu thì gọi nhé', points: 1, userCooldownMs: 20000 }
];

/**
 * Phiên bản cấu hình hiện tại. Tăng số này khi đổi mặc định theo kiểu cần nâng cấp cấu hình đã lưu
 * (thêm bước tương ứng trong `upgradeConfig`).
 * - 1: bản đầu (chủ đề cũ, kích hoạt bằng bình luận số 1–9 / từ khoá; một mapping giftId 0).
 * - 2: kích hoạt chỉ bằng quà, ánh xạ quà theo bậc kim cương (minDiamonds).
 * - 3: chủ đề câu cá "ĐI CÂU THÔI!" — đổi id hành động (kéo cá to), `king`, `fishing`, việc vui mới.
 */
export const CONFIG_VERSION = 3;

export function defaultGameConfig(): GameConfig {
  return structuredClone({
    version: CONFIG_VERSION,
    actions: DEFAULT_ACTIONS,
    gifts: DEFAULT_GIFTS,
    king: DEFAULT_KING,
    fishing: DEFAULT_FISHING,
    collective: DEFAULT_COLLECTIVE,
    limits: DEFAULT_LIMITS,
    work: DEFAULT_WORK,
    blocklist: [...DEFAULT_BLOCKLIST]
  });
}

/** Mapping quà trỏ tới hành động đã bị bỏ sẽ được chuyển sang hành động này. */
export const FALLBACK_GIFT_ACTION_ID = 'pull_grass_carp';

/**
 * Id hành động của bản ≤ 2 (chủ đề cũ) → id mới cùng bậc quà. Dùng khi nâng cấp lên bản 3.
 */
export const LEGACY_ACTION_IDS: Readonly<Record<string, string>> = {
  throw_paper: 'pull_carp',
  pluck_tree: 'pull_grass_carp',
  doodle_kpi: 'pull_catfish',
  complaint_call: 'pull_snakehead',
  crash_pc: 'pull_giant_catfish',
  lock_toilet: 'pull_arowana',
  flat_tire: 'pull_stingray',
  blackout: 'pull_legend',
  praise_boss: 'pull_koi',
  strike: 'grand_haul'
};

export interface ReconcileResult {
  config: GameConfig;
  added: string[];
  /** Id hành động có trong cấu hình đã lưu nhưng không còn (bị bỏ hoặc đã đổi sang id mới) — store xoá các dòng này. */
  removed: string[];
  remappedGifts: number;
  /** Phiên bản cũ đã được nâng cấp (undefined = không cần nâng cấp). */
  upgradedFrom?: number;
  changed: boolean;
}

/** Mapping quà mặc định của bản 1 (đã quy đổi sang id mới) — bị thay bằng các bậc kim cương khi nâng cấp. */
const V1_DEFAULT_GIFTS: Pick<GiftMapping, 'giftId' | 'actionId' | 'minCount'>[] = [
  { giftId: 5655, actionId: 'pull_carp', minCount: 1 },
  { giftId: 5655, actionId: 'pull_stingray', minCount: 10 }
];

/** Cấu hình lưu bởi bản cũ có thể còn các trường tên cũ. */
type LegacyShape = Omit<GameConfig, 'king' | 'fishing'> & {
  king?: GameConfig['king'];
  fishing?: GameConfig['fishing'];
  boss?: GameConfig['king'];
};
type LegacyAction = Omit<ActionConfig, 'kingEffect'> & {
  kingEffect?: ActionConfig['kingEffect'];
  bossEffect?: ActionConfig['kingEffect'];
};

/**
 * Đưa cấu hình đã lưu về đúng hình dạng hiện tại: `boss` → `king`, `bossEffect` → `kingEffect`,
 * thiếu `king` / `fishing` thì lấy mặc định. Trả về `changed` nếu có sửa.
 */
function normalizeShape(stored: GameConfig, defaults: GameConfig): { cfg: GameConfig; changed: boolean } {
  const { boss, king, fishing, ...rest } = stored as LegacyShape;
  // Trường câu mới thêm sau (vd. catchesPerTick) → bổ sung giá trị mặc định, giữ phần admin đã chỉnh.
  const missingFishingKey = !!fishing && Object.keys(defaults.fishing).some((k) => !(k in fishing));
  // Bộ lọc từ thêm sau: cấu hình cũ chưa có → lấy danh sách mặc định.
  const missingBlocklist = !Array.isArray(rest.blocklist);
  let changed = boss !== undefined || !king || !fishing || missingFishingKey || missingBlocklist;
  const actions = (rest.actions ?? []).map((a) => {
    const { bossEffect, kingEffect, ...action } = a as LegacyAction;
    if (bossEffect === undefined && kingEffect) return a as ActionConfig;
    changed = true;
    return { ...action, kingEffect: kingEffect ?? bossEffect ?? { calm: 0, stamina: 0 } } as ActionConfig;
  });
  return {
    cfg: {
      ...rest,
      actions,
      king: king ?? boss ?? structuredClone(defaults.king),
      fishing: { ...structuredClone(defaults.fishing), ...fishing },
      blocklist: missingBlocklist ? [...(defaults.blocklist ?? [])] : rest.blocklist
    },
    changed
  };
}

/**
 * Bước đầu của nâng cấp lên bản 3: đổi id hành động cũ sang id mới. Giữ chỉnh sửa của admin
 * (bật/tắt, trigger, cooldown, priority); tên, lane, thời lượng, điểm, cá và tác động lên Cá Thần
 * đặt lại theo mặc định mới (hoạt ảnh khác hẳn). Đổi `actionId` trong mapping quà và sự kiện tập thể.
 * Nếu cấu hình đã có sẵn id mới (store vừa chèn bổ sung hành động mặc định) thì bản đổi từ id cũ thắng.
 */
function renameLegacyActions(cfg: GameConfig, defaults: GameConfig): GameConfig {
  const byId = new Map(defaults.actions.map((a) => [a.id, a]));
  const renamedTargets = new Set(
    cfg.actions.map((a) => LEGACY_ACTION_IDS[a.id]).filter((id): id is string => id !== undefined && byId.has(id))
  );
  const actions = cfg.actions.flatMap((a): ActionConfig[] => {
    const to = LEGACY_ACTION_IDS[a.id];
    const def = to ? byId.get(to) : undefined;
    if (def) {
      return [
        {
          ...structuredClone(def),
          enabled: a.enabled,
          trigger: a.trigger,
          cooldownMs: a.cooldownMs,
          userCooldownMs: a.userCooldownMs,
          priority: a.priority
        }
      ];
    }
    if (renamedTargets.has(a.id)) return []; // bản mặc định vừa chèn — nhường cho bản đổi từ id cũ
    return [a];
  });
  const mapId = (id: string) => LEGACY_ACTION_IDS[id] ?? id;
  return {
    ...cfg,
    actions,
    gifts: cfg.gifts.map((g) => (LEGACY_ACTION_IDS[g.actionId] ? { ...g, actionId: mapId(g.actionId) } : g)),
    collective: cfg.collective ? { ...cfg.collective, actionId: mapId(cfg.collective.actionId) } : cfg.collective
  };
}

/**
 * Nâng cấp cấu hình đã lưu lên CONFIG_VERSION — chỉ chạy khi `version` đã lưu thấp hơn (thiếu = 1),
 * nên chỉnh sửa của admin SAU khi nâng cấp được giữ nguyên ở các lần khởi động sau.
 * (Việc đổi id hành động cũ → mới đã làm trước đó trong `reconcileConfig` bằng `renameLegacyActions`.)
 *
 * 1 → 2 (kích hoạt chỉ bằng quà):
 * - hành động có trigger mặc định rỗng → bỏ trigger bình luận/like/share/từ khoá cũ;
 * - bỏ mapping quà mặc định cũ (mọi bậc giftId 0 và Rose / Rose x10) rồi thêm các bậc kim cương mới;
 *   mapping quà riêng admin tự thêm được giữ, mapping mặc định có giftId trùng với cái admin đã có thì bỏ qua.
 *
 * 2 → 3 (chủ đề câu cá):
 * - `work` thay bằng việc vui mặc định; `fishing` đặt theo mặc định;
 * - sự kiện tập thể: tên / mô tả / danh hiệu thưởng đặt lại theo mặc định mới (giữ bật/tắt, mục tiêu, thời gian).
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
  if (from < 3) {
    const dc = defaults.collective;
    out = {
      ...out,
      work: structuredClone(defaults.work),
      fishing: structuredClone(defaults.fishing),
      collective: { ...dc, ...out.collective, name: dc.name, description: dc.description, rewardTitle: dc.rewardTitle }
    };
  }
  return { ...out, version: Math.max(from, defaults.version ?? CONFIG_VERSION) };
}

/**
 * Đồng bộ cấu hình đã lưu với danh sách hành động trong code (overlay chỉ có hoạt ảnh cho các id mặc định):
 * - chuẩn hoá trường tên cũ (`boss` → `king`, `bossEffect` → `kingEffect`, thiếu `fishing` / `blocklist` → mặc định);
 * - bản ≤ 2: đổi id hành động cũ sang id mới (`LEGACY_ACTION_IDS`);
 * - nâng cấp cấu hình phiên bản cũ một lần (`upgradeConfig`);
 * - thêm hành động mặc định còn thiếu (giữ nguyên chỉnh sửa của admin với hành động đã có);
 * - xoá hành động không còn trong `defaults.actions`;
 * - sắp xếp hành động theo thứ tự mặc định;
 * - mapping quà trỏ tới hành động bị xoá → chuyển sang `FALLBACK_GIFT_ACTION_ID` (không mất mapping của admin);
 * - ép `limits.maxConcurrent = 1` (hành động chạy nối tiếp).
 */
export function reconcileConfig(stored: GameConfig, defaults: GameConfig): ReconcileResult {
  const storedVersion = stored.version ?? 1;
  const target = defaults.version ?? CONFIG_VERSION;
  const needsUpgrade = storedVersion < target;

  const order = new Map(defaults.actions.map((a, i) => [a.id, i]));
  const removed = (stored.actions ?? []).filter((a) => !order.has(a.id)).map((a) => a.id);

  const normalized = normalizeShape(stored, defaults);
  const base = needsUpgrade && storedVersion < 3 ? renameLegacyActions(normalized.cfg, defaults) : normalized.cfg;

  const baseIds = new Set(base.actions.map((a) => a.id));
  const added = defaults.actions.filter((a) => !baseIds.has(a.id)).map((a) => a.id);

  const actions = [
    ...base.actions.filter((a) => order.has(a.id)),
    ...defaults.actions.filter((a) => !baseIds.has(a.id)).map((a) => structuredClone(a))
  ].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const sortChanged = actions.some((a, i) => stored.actions[i]?.id !== a.id) || actions.length !== stored.actions.length;

  const fallback = order.has(FALLBACK_GIFT_ACTION_ID) ? FALLBACK_GIFT_ACTION_ID : defaults.actions[0]?.id;
  let remappedGifts = 0;
  const gifts = base.gifts.flatMap((g) => {
    if (order.has(g.actionId)) return [g];
    if (!fallback) return [];
    remappedGifts += 1;
    return [{ ...g, actionId: fallback }];
  });

  const limits = base.limits ? { ...base.limits, maxConcurrent: 1 } : base.limits;
  const limitsChanged = base.limits?.maxConcurrent !== 1;

  const config = needsUpgrade
    ? upgradeConfig({ ...base, actions, gifts, limits }, defaults)
    : { ...base, actions, gifts, limits };

  return {
    config,
    added,
    removed,
    remappedGifts,
    upgradedFrom: needsUpgrade ? storedVersion : undefined,
    changed: normalized.changed || sortChanged || remappedGifts > 0 || limitsChanged || needsUpgrade
  };
}
