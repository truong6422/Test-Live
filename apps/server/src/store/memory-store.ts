import type { CollectiveState, GameConfig, HistoryEntry } from '@sep/shared';
import { reconcileConfig } from '../config/defaults';
import type { PlayerRecord } from '../players/players';
import type { GameStore, HistoryQuery } from './store';

/** Lưu trong bộ nhớ — cho test và chạy thử không cần PostgreSQL. */
export class MemoryStore implements GameStore {
  config: GameConfig | null = null;
  players = new Map<string, PlayerRecord>();
  sessions = new Map<string, { endedAt: number | null }>();
  history: HistoryEntry[] = [];
  collectives = new Map<string, CollectiveState>();

  async init(defaults: GameConfig): Promise<void> {
    if (!this.config) {
      this.config = structuredClone(defaults);
      return;
    }
    // Giống PgStore: đồng bộ danh sách hành động với code, chuyển mapping quà, ép chạy nối tiếp.
    this.config = reconcileConfig(structuredClone(this.config), defaults).config;
  }
  async loadConfig(): Promise<GameConfig> {
    const cfg = structuredClone(this.config!);
    cfg.work ??= [];
    return cfg;
  }
  async saveConfig(cfg: GameConfig): Promise<void> {
    this.config = structuredClone(cfg);
  }
  async loadPlayers(): Promise<PlayerRecord[]> {
    return [...this.players.values()].map((p) => structuredClone(p));
  }
  async savePlayers(_sessionId: string | null, batch: { player: PlayerRecord }[]): Promise<void> {
    for (const { player } of batch) this.players.set(player.platformId, structuredClone(player));
  }
  async startSession(id: string): Promise<void> {
    this.sessions.set(id, { endedAt: null });
  }
  async endSession(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) s.endedAt = Date.now();
  }
  async openSession(): Promise<string | null> {
    const open = [...this.sessions.entries()].filter(([, s]) => s.endedAt === null);
    return open.at(-1)?.[0] ?? null;
  }
  async appendHistory(entries: HistoryEntry[]): Promise<void> {
    this.history.push(...entries);
    if (this.history.length > 20_000) this.history.splice(0, this.history.length - 20_000);
  }
  async listHistory(q: HistoryQuery): Promise<HistoryEntry[]> {
    return this.history
      .filter((h) => (!q.sessionId || h.sessionId === q.sessionId) && (!q.outcome || h.outcome === q.outcome))
      .slice(-q.limit)
      .reverse();
  }
  async pruneHistory(olderThan: Date): Promise<number> {
    const before = this.history.length;
    this.history = this.history.filter((h) => h.createdAt >= olderThan.getTime());
    return before - this.history.length;
  }
  async saveCollective(_s: string | null, state: CollectiveState): Promise<void> {
    this.collectives.set(state.roundId, { ...state });
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}
