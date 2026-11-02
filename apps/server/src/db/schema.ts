import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { ActionTrigger, BossEffect, Lane } from '@sep/shared';

/**
 * Nhân viên (người xem đã tham gia). Chỉ lưu những gì cần cho trò chơi:
 * ID nền tảng, username, tên hiển thị, URL avatar và thống kê trong game.
 * Người chỉ vào xem mà không tương tác thì KHÔNG được lưu.
 */
export const players = pgTable('players', {
  platformId: text('platform_id').primaryKey(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  totalParticipations: integer('total_participations').notNull().default(0),
  totalPoints: integer('total_points').notNull().default(0),
  /** Tổng kim cương đã tặng (xếp hạng "phá Sếp" bằng quà). */
  totalDiamonds: integer('total_diamonds').notNull().default(0),
  actionCounts: jsonb('action_counts').$type<Record<string, number>>().notNull().default({}),
  grantedTitles: jsonb('granted_titles').$type<string[]>().notNull().default([]),
  title: text('title').notNull().default('Nhân viên chăm chỉ'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const liveSessions = pgTable('live_sessions', {
  id: text('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  tiktokUsername: text('tiktok_username')
});

export const sessionPlayers = pgTable(
  'session_players',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => liveSessions.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.platformId, { onDelete: 'cascade' }),
    participations: integer('participations').notNull().default(0),
    points: integer('points').notNull().default(0),
    diamonds: integer('diamonds').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.playerId] })]
);

export const actions = pgTable('actions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  trigger: jsonb('trigger').$type<ActionTrigger>().notNull(),
  durationMs: integer('duration_ms').notNull(),
  cooldownMs: integer('cooldown_ms').notNull(),
  userCooldownMs: integer('user_cooldown_ms').notNull(),
  priority: integer('priority').notNull(),
  lanes: jsonb('lanes').$type<Lane[]>().notNull(),
  bossEffect: jsonb('boss_effect').$type<BossEffect>().notNull(),
  points: integer('points').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0)
});

export const giftMappings = pgTable('gift_mappings', {
  id: serial('id').primaryKey(),
  giftId: integer('gift_id').notNull(),
  giftName: text('gift_name').notNull(),
  actionId: text('action_id')
    .notNull()
    .references(() => actions.id, { onDelete: 'cascade' }),
  minCount: integer('min_count').notNull().default(1),
  /** Mốc giá trị tối thiểu (kim cương × số lượng) cho bậc quà. */
  minDiamonds: integer('min_diamonds').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true)
});

export const collectiveEvents = pgTable('collective_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => liveSessions.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  goal: integer('goal').notNull(),
  progress: integer('progress').notNull().default(0),
  participants: integer('participants').notNull().default(0),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  rewardTitle: text('reward_title')
});

export const eventHistory = pgTable(
  'event_history',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id'),
    eventId: text('event_id').notNull(),
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    playerId: text('player_id'),
    actorName: text('actor_name').notNull(),
    actionId: text('action_id'),
    outcome: text('outcome').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (t) => [index('event_history_created_at_idx').on(t.createdAt), index('event_history_session_idx').on(t.sessionId)]
);

/** Cấu hình dạng key/value: boss, collective, limits. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull()
});
