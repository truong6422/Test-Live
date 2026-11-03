import path from 'node:path';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { CollectiveConfig, CollectiveState, EngineLimits, FishingConfig, GameConfig, HistoryEntry, KingConfig, WorkTask } from '@cau/shared';
import { reconcileConfig } from '../config/defaults';
import * as s from '../db/schema';
import type { PlayerRecord, SessionStat } from '../players/players';
import type { GameStore, HistoryQuery } from './store';

/** Docker (server đã bundle) đặt MIGRATIONS_DIR; dev dùng thư mục mã nguồn. */
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(import.meta.dir, '..', 'db', 'migrations');

export class PgStore implements GameStore {
  private client: postgres.Sql;
  private db: PostgresJsDatabase<typeof s>;

  constructor(url: string) {
    this.client = postgres(url, { max: 5, onnotice: () => {} });
    this.db = drizzle(this.client, { schema: s });
  }

  async init(defaults: GameConfig): Promise<void> {
    await migrate(this.db, { migrationsFolder: MIGRATIONS_DIR });
    const [{ count } = { count: 0 }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(s.actions);
    if (count === 0) {
      await this.saveConfig(defaults);
      return;
    }
    // Phiên bản mới có thêm hành động mặc định: chèn bổ sung, không ghi đè cấu hình admin đã sửa.
    await this.db
      .insert(s.actions)
      .values(defaults.actions.map((a, i) => actionRow(a, i)))
      .onConflictDoNothing();
    // Bản cũ lưu cấu hình Cá Thần dưới khoá `boss`: chép sang `king` (nếu chưa có) trước khi chèn mặc định.
    const [legacyKing] = await this.db.select().from(s.settings).where(eq(s.settings.key, 'boss'));
    if (legacyKing) await this.db.insert(s.settings).values({ key: 'king', value: legacyKing.value }).onConflictDoNothing();
    for (const [key, value] of Object.entries({
      king: defaults.king,
      fishing: defaults.fishing,
      collective: defaults.collective,
      limits: defaults.limits,
      work: defaults.work,
      // Bộ lọc từ: chỉ là một khoá trong bảng settings (key/value) — không cần migration.
      blocklist: defaults.blocklist
    })) {
      await this.db.insert(s.settings).values({ key, value }).onConflictDoNothing();
    }
    // Hành động do code quy định: xoá hành động cũ không còn hoạt ảnh, chuyển mapping quà của chúng,
    // ép chạy nối tiếp. Làm trong code (không phải migration) vì actions/settings chỉ là dữ liệu.
    const r = reconcileConfig(await this.loadConfig(), defaults);
    if (r.changed) {
      // saveConfig ghi lại mapping quà đã chuyển TRƯỚC khi xoá hành động (FK gift_mappings → actions là cascade).
      await this.saveConfig(r.config);
      if (r.removed.length > 0) await this.db.delete(s.actions).where(inArray(s.actions.id, r.removed));
    }
  }

  async loadConfig(): Promise<GameConfig> {
    const [actionRows, giftRows, settingRows] = await Promise.all([
      this.db.select().from(s.actions).orderBy(s.actions.sortOrder),
      this.db.select().from(s.giftMappings).orderBy(s.giftMappings.id),
      this.db.select().from(s.settings)
    ]);
    const setting = <T>(key: string) => settingRows.find((r) => r.key === key)?.value as T;
    return {
      actions: actionRows.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        trigger: r.trigger,
        durationMs: r.durationMs,
        cooldownMs: r.cooldownMs,
        userCooldownMs: r.userCooldownMs,
        priority: r.priority,
        lanes: r.lanes,
        kingEffect: r.kingEffect,
        points: r.points,
        ...(r.fish ? { fish: r.fish } : {})
      })),
      gifts: giftRows.map((r) => ({
        giftId: r.giftId,
        giftName: r.giftName,
        actionId: r.actionId,
        minCount: r.minCount,
        minDiamonds: r.minDiamonds,
        enabled: r.enabled
      })),
      king: setting<KingConfig>('king') ?? setting<KingConfig>('boss'),
      fishing: setting<FishingConfig>('fishing'),
      collective: setting<CollectiveConfig>('collective'),
      limits: setting<EngineLimits>('limits'),
      work: setting<WorkTask[]>('work') ?? [],
      // Thiếu (DB cũ) → reconcileConfig điền danh sách mặc định.
      blocklist: setting<string[]>('blocklist'),
      // Thiếu key 'version' = cấu hình bản 1 (trước khi có đánh số phiên bản) → reconcileConfig nâng cấp một lần.
      version: setting<number>('version') ?? 1
    };
  }

  async saveConfig(cfg: GameConfig): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [i, a] of cfg.actions.entries()) {
        const row = actionRow(a, i);
        await tx.insert(s.actions).values(row).onConflictDoUpdate({ target: s.actions.id, set: row });
      }
      await tx.delete(s.giftMappings);
      if (cfg.gifts.length > 0) await tx.insert(s.giftMappings).values(cfg.gifts.map((g) => ({ ...g, minDiamonds: g.minDiamonds ?? 0 })));
      const entries: Record<string, unknown> = { king: cfg.king, fishing: cfg.fishing, collective: cfg.collective, limits: cfg.limits, work: cfg.work };
      if (Array.isArray(cfg.blocklist)) entries.blocklist = cfg.blocklist;
      if (cfg.version !== undefined) entries.version = cfg.version;
      for (const [key, value] of Object.entries(entries)) {
        await tx.insert(s.settings).values({ key, value }).onConflictDoUpdate({ target: s.settings.key, set: { value } });
      }
    });
  }

  async loadPlayers(): Promise<PlayerRecord[]> {
    const rows = await this.db.select().from(s.players);
    return rows.map((r) => ({
      platformId: r.platformId,
      username: r.username,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl ?? undefined,
      totalParticipations: r.totalParticipations,
      totalPoints: r.totalPoints,
      totalDiamonds: r.totalDiamonds,
      totalGrams: r.totalGrams,
      actionCounts: r.actionCounts,
      grantedTitles: r.grantedTitles
    }));
  }

  async savePlayers(
    sessionId: string | null,
    batch: { player: PlayerRecord & { title: string }; session: SessionStat | undefined }[]
  ): Promise<void> {
    if (batch.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const { player: p, session } of batch) {
        const row = {
          platformId: p.platformId,
          username: p.username,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl ?? null,
          totalParticipations: p.totalParticipations,
          totalPoints: p.totalPoints,
          totalDiamonds: p.totalDiamonds ?? 0,
          totalGrams: p.totalGrams ?? 0,
          actionCounts: p.actionCounts,
          grantedTitles: p.grantedTitles,
          title: p.title,
          updatedAt: new Date()
        };
        await tx.insert(s.players).values(row).onConflictDoUpdate({ target: s.players.platformId, set: row });
        if (sessionId && session) {
          await tx
            .insert(s.sessionPlayers)
            .values({ sessionId, playerId: p.platformId, ...session })
            .onConflictDoUpdate({ target: [s.sessionPlayers.sessionId, s.sessionPlayers.playerId], set: { ...session } });
        }
      }
    });
  }

  async startSession(id: string, tiktokUsername: string | null): Promise<void> {
    await this.db.insert(s.liveSessions).values({ id, tiktokUsername }).onConflictDoNothing();
  }

  async endSession(id: string): Promise<void> {
    await this.db.update(s.liveSessions).set({ endedAt: new Date() }).where(eq(s.liveSessions.id, id));
  }

  async openSession(): Promise<string | null> {
    const [row] = await this.db
      .select({ id: s.liveSessions.id })
      .from(s.liveSessions)
      .where(isNull(s.liveSessions.endedAt))
      .orderBy(desc(s.liveSessions.startedAt))
      .limit(1);
    return row?.id ?? null;
  }

  async appendHistory(entries: HistoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(s.eventHistory)
      .values(entries.map((e) => ({ ...e, createdAt: new Date(e.createdAt) })))
      .onConflictDoNothing();
  }

  async listHistory(q: HistoryQuery): Promise<HistoryEntry[]> {
    const conds = [
      q.sessionId ? eq(s.eventHistory.sessionId, q.sessionId) : undefined,
      q.outcome ? eq(s.eventHistory.outcome, q.outcome) : undefined
    ].filter(Boolean);
    const rows = await this.db
      .select()
      .from(s.eventHistory)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.eventHistory.createdAt))
      .limit(q.limit);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }) as HistoryEntry);
  }

  async pruneHistory(olderThan: Date): Promise<number> {
    const res = await this.db.delete(s.eventHistory).where(lt(s.eventHistory.createdAt, olderThan)).returning({ id: s.eventHistory.id });
    return res.length;
  }

  async saveCollective(sessionId: string | null, st: CollectiveState, rewardTitle: string): Promise<void> {
    const row = {
      id: st.roundId,
      sessionId,
      name: st.name,
      description: st.description,
      goal: st.goal,
      progress: st.progress,
      participants: st.participants,
      status: st.status,
      startedAt: new Date(st.startedAt),
      endsAt: st.endsAt ? new Date(st.endsAt) : null,
      rewardTitle
    };
    await this.db.insert(s.collectiveEvents).values(row).onConflictDoUpdate({ target: s.collectiveEvents.id, set: row });
  }

  async ping(): Promise<boolean> {
    try {
      await this.client`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}

function actionRow(a: GameConfig['actions'][number], sortOrder: number) {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    trigger: a.trigger,
    durationMs: a.durationMs,
    cooldownMs: a.cooldownMs,
    userCooldownMs: a.userCooldownMs,
    priority: a.priority,
    lanes: a.lanes,
    kingEffect: a.kingEffect,
    points: a.points,
    fish: a.fish ?? null,
    sortOrder
  };
}
