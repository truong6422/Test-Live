import { z } from 'zod';

// Schema validate dữ liệu admin gửi lên REST API.

export const laneSchema = z.enum(['king', 'lake', 'dock', 'sky', 'underwater', 'anglers']);

export const bigFishSchema = z.object({
  emoji: z.string().min(1).max(8),
  name: z.string().min(1).max(40),
  minKg: z.number().min(0).max(10_000),
  maxKg: z.number().min(0).max(10_000)
});

export const actionUpdateSchema = z
  .object({
    name: z.string().min(1).max(60),
    enabled: z.boolean(),
    keywords: z.array(z.string().min(1).max(40)).max(30),
    triggerKinds: z.array(z.enum(['comment', 'like', 'share', 'follow'])).max(4),
    durationMs: z.number().int().min(500).max(60_000),
    cooldownMs: z.number().int().min(0).max(600_000),
    userCooldownMs: z.number().int().min(0).max(600_000),
    priority: z.number().int().min(0).max(10_000),
    points: z.number().int().min(0).max(100_000),
    kingCalm: z.number().int().min(-100).max(100),
    kingStamina: z.number().int().min(-100).max(100),
    fish: bigFishSchema.nullable(),
    /** Chỉ người đã follow mới kích hoạt được bằng bình luận/like/share/follow (quà luôn được). */
    followersOnly: z.boolean()
  })
  .partial();

export type ActionUpdate = z.infer<typeof actionUpdateSchema>;

export const giftMappingSchema = z.object({
  giftId: z.number().int().min(0),
  giftName: z.string().min(1).max(60),
  actionId: z.string().min(1).max(40),
  minCount: z.number().int().min(1).max(10_000),
  /** Mốc giá trị tối thiểu (kim cương) = kim cương một món × số lượng sau khi gộp streak. */
  minDiamonds: z.number().int().min(0).max(10_000_000).optional(),
  enabled: z.boolean()
});

export const giftMappingsSchema = z.array(giftMappingSchema).max(200);

export const lootItemSchema = z.object({
  emoji: z.string().min(1).max(8),
  name: z.string().min(1).max(40),
  weight: z.number().min(0).max(10_000),
  minKg: z.number().min(0).max(1000),
  maxKg: z.number().min(0).max(1000),
  points: z.number().int().min(0).max(100_000)
});

export const workTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  name: z.string().min(1).max(60),
  enabled: z.boolean(),
  keywords: z.array(z.string().min(1).max(40)).max(30),
  emoji: z.string().min(1).max(8),
  text: z.string().max(80),
  points: z.number().int().min(0).max(100_000),
  userCooldownMs: z.number().int().min(0).max(600_000),
  loot: z.array(lootItemSchema).max(40).optional()
});

export const workTasksSchema = z.array(workTaskSchema).max(50);

export const fishingUpdateSchema = z
  .object({
    tickMs: z.number().int().min(1000).max(600_000),
    catchesPerTick: z.number().int().min(1).max(50),
    targetCatchMs: z.number().int().min(1000).max(3600_000),
    maxCatchesPerTick: z.number().int().min(1).max(50),
    bigFishShadowMs: z.number().int().min(0).max(120_000),
    loot: z.array(lootItemSchema).min(1).max(40),
    bigFishEveryMs: z.number().int().min(0).max(24 * 3600_000),
    bigFishActionId: z.string().min(1).max(40),
    frontSeats: z.number().int().min(0).max(12),
    idleKickMs: z.number().int().min(0).max(24 * 3600_000)
  })
  .partial();

/** Một từ trong bộ lọc: không khoảng trắng (so khớp theo từng từ). */
export const blockedWordSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\S+$/, 'Mỗi mục chỉ là một từ (không có khoảng trắng)');

export const blocklistSchema = z.array(blockedWordSchema).max(1000);

export const blocklistTestSchema = z.object({
  text: z.string().max(500),
  /** Thử với danh sách nháp (chưa lưu); bỏ trống = danh sách đang dùng. */
  words: blocklistSchema.optional()
});

export const lakeKickSchema = z.object({
  platformId: z.string().min(1).max(200)
});

export const kingAdjustSchema = z.object({
  calm: z.number().min(0).max(100)
});

export const collectiveUpdateSchema = z
  .object({
    enabled: z.boolean(),
    name: z.string().min(1).max(60),
    description: z.string().max(200),
    goal: z.number().int().min(1).max(100_000),
    durationMs: z.number().int().min(0).max(24 * 3600_000),
    restartDelayMs: z.number().int().min(0).max(3600_000)
  })
  .partial();

export const liveConnectSchema = z.object({
  username: z.string().min(1).max(200)
});

export const loginSchema = z.object({
  password: z.string().min(1).max(200)
});

export const manualTriggerSchema = z.object({
  displayName: z.string().min(1).max(40).optional()
});
