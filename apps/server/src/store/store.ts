import type { CollectiveState, EventOutcome, GameConfig, HistoryEntry } from '@cau/shared';
import type { PlayerRecord, SessionStat } from '../players/players';
export type { SessionStat };

/** Trạng thái chạy để khôi phục sau khi khởi động lại. */
export interface RuntimeState {
  running: boolean;
  sessionId: string | null;
  /** Mốc (ms) sự kiện LIVE hợp lệ gần nhất hoặc lần bấm chạy gần nhất. */
  lastActivityAt: number;
}

export interface HistoryQuery {
  limit: number;
  sessionId?: string;
  outcome?: EventOutcome;
}

/**
 * Lớp lưu trữ. Engine không phụ thuộc vào đây — host (index.ts) nối hai bên.
 * Có 2 bản cài đặt: PgStore (PostgreSQL) và MemoryStore (test / thử nhanh).
 */
export interface GameStore {
  /** Chạy migration + seed cấu hình mặc định nếu DB trống. */
  init(defaults: GameConfig): Promise<void>;
  loadConfig(): Promise<GameConfig>;
  saveConfig(cfg: GameConfig): Promise<void>;

  loadPlayers(): Promise<PlayerRecord[]>;
  savePlayers(sessionId: string | null, batch: { player: PlayerRecord & { title: string }; session: SessionStat | undefined }[]): Promise<void>;

  /** Thống kê từng người của một phiên (để nạp lại bộ đếm phiên sau khi khởi động lại). */
  loadSessionStats(sessionId: string): Promise<{ playerId: string; stat: SessionStat }[]>;

  /** Trạng thái chạy (game có đang chạy, hoạt động gần nhất) — lưu trong bảng settings, không cần migration. */
  loadRuntime(): Promise<RuntimeState | null>;
  saveRuntime(state: RuntimeState): Promise<void>;

  startSession(id: string, tiktokUsername: string | null): Promise<void>;
  endSession(id: string): Promise<void>;
  /** Phiên chưa kết thúc gần nhất (để khôi phục sau khi khởi động lại). */
  openSession(): Promise<string | null>;

  appendHistory(entries: HistoryEntry[]): Promise<void>;
  listHistory(q: HistoryQuery): Promise<HistoryEntry[]>;
  pruneHistory(olderThan: Date): Promise<number>;

  saveCollective(sessionId: string | null, state: CollectiveState, rewardTitle: string): Promise<void>;

  ping(): Promise<boolean>;
  close(): Promise<void>;
}
