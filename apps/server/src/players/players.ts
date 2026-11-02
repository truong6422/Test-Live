import { ROSTER_MAX, type LeaderboardEntry, type LiveUser, type PlayerTitle, type RosterMember } from '@sep/shared';

export interface PlayerRecord {
  platformId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  totalParticipations: number;
  totalPoints: number;
  /** Tổng kim cương đã tặng (toàn thời gian). Bản ghi cũ không có = 0. */
  totalDiamonds?: number;
  /** Số lần kích hoạt từng hành động — dùng để tính danh hiệu. */
  actionCounts: Record<string, number>;
  /** Danh hiệu được trao từ sự kiện tập thể. */
  grantedTitles: string[];
}

export interface SessionStat {
  /** Kim cương đã tặng trong phiên. */
  diamonds: number;
  participations: number;
  points: number;
}

/** Trạng thái trong phiên, chỉ giữ trong bộ nhớ (không lưu DB). */
interface Presence {
  follower: boolean;
  /** Số thứ tự tăng dần của lần tương tác gần nhất. */
  lastActive: number;
}

export const TITLES: Record<PlayerTitle['id'], string> = {
  diligent: 'Nhân viên chăm chỉ',
  deadline_breaker: 'Chuyên gia phá deadline',
  rebel: 'Nhân viên chống đối',
  meeting_boss: 'Trùm họp hành',
  boss_enemy: 'Kẻ thù của Sếp'
};

/** Danh hiệu vui, suy ra từ thống kê (không nhập tay). Thứ tự ưu tiên từ cao xuống thấp. */
export function computeTitle(p: Pick<PlayerRecord, 'totalPoints' | 'actionCounts' | 'grantedTitles'>): string {
  const c = p.actionCounts;
  if (p.totalPoints >= 300) return TITLES.boss_enemy;
  // emergency_meeting / spill_coffee là hành động đã bỏ — vẫn cộng để người chơi cũ giữ danh hiệu.
  if ((c.doodle_kpi ?? 0) + (c.emergency_meeting ?? 0) >= 3) return TITLES.meeting_boss;
  if ((c.throw_paper ?? 0) + (c.pluck_tree ?? 0) + (c.spill_coffee ?? 0) >= 5) return TITLES.deadline_breaker;
  if (p.grantedTitles.length > 0) return p.grantedTitles[p.grantedTitles.length - 1]!;
  return TITLES.diligent;
}

export const isDemoPlayer = (platformId: string) => platformId.startsWith('demo:');

/**
 * Quản lý nhân viên trong bộ nhớ: tổng hợp toàn thời gian + thống kê phiên hiện tại.
 * Thay đổi được đánh dấu "dirty" để lớp lưu trữ ghi xuống DB theo lô.
 */
export class PlayerRegistry {
  private players = new Map<string, PlayerRecord>();
  private session = new Map<string, SessionStat>();
  private dirty = new Set<string>();
  private presence = new Map<string, Presence>();
  private activeSeq = 0;

  load(records: PlayerRecord[]): void {
    for (const r of records) this.players.set(r.platformId, { ...r });
  }

  participate(user: LiveUser, points: number, actionId?: string): PlayerRecord {
    const p = this.upsert(user);
    p.totalParticipations += 1;
    p.totalPoints += points;
    if (actionId) p.actionCounts[actionId] = (p.actionCounts[actionId] ?? 0) + 1;
    const s = this.session.get(p.platformId) ?? { participations: 0, points: 0, diamonds: 0 };
    s.participations += 1;
    s.points += points;
    this.session.set(p.platformId, s);
    this.dirty.add(p.platformId);
    const pr = this.presence.get(p.platformId) ?? { follower: false, lastActive: 0 };
    // Đã thấy follow một lần thì giữ nguyên trong phiên (TikTok không phải lúc nào cũng gửi trạng thái).
    if (user.follower === true) pr.follower = true;
    pr.lastActive = ++this.activeSeq;
    this.presence.set(p.platformId, pr);
    return p;
  }

  /** Đánh dấu đã follow (sự kiện follow) → lên nhân viên chính thức. Trả về true nếu thay đổi. */
  markFollower(platformId: string): boolean {
    const pr = this.presence.get(platformId);
    if (!pr || pr.follower) return false;
    pr.follower = true;
    return true;
  }

  /** Đã follow trong phiên này (theo trạng thái TikTok báo hoặc sự kiện follow). */
  isFollower(platformId: string): boolean {
    return this.presence.get(platformId)?.follower === true;
  }

  /** Những người có mặt trong phiên, gần đây nhất trước, tối đa ROSTER_MAX. */
  roster(limit = ROSTER_MAX): RosterMember[] {
    return [...this.presence.entries()]
      .sort((a, b) => b[1].lastActive - a[1].lastActive)
      .slice(0, limit)
      .map(([id, pr]) => {
        const p = this.players.get(id)!;
        return { platformId: id, displayName: p.displayName, follower: pr.follower, points: this.session.get(id)?.points ?? 0 };
      });
  }

  /** Cộng thêm điểm/hành động cho lượt tham gia vừa ghi (không tính thêm lượt). */
  addActionPoints(platformId: string, points: number, actionId: string): void {
    const p = this.players.get(platformId);
    if (!p) return;
    p.totalPoints += points;
    p.actionCounts[actionId] = (p.actionCounts[actionId] ?? 0) + 1;
    const s = this.session.get(platformId);
    if (s) s.points += points;
    this.dirty.add(platformId);
  }

  grantTitle(platformId: string, title: string): void {
    const p = this.players.get(platformId);
    if (!p || p.grantedTitles.includes(title)) return;
    p.grantedTitles.push(title);
    this.dirty.add(platformId);
  }

  get(platformId: string): PlayerRecord | undefined {
    return this.players.get(platformId);
  }

  participants(): number {
    return this.session.size;
  }

  /** Cộng kim cương đã tặng (tổng giá trị một lượt quà) cho người chơi đã ghi nhận lượt tham gia. */
  addDiamonds(platformId: string, diamonds: number): void {
    if (!(diamonds > 0)) return;
    const p = this.players.get(platformId);
    if (!p) return;
    p.totalDiamonds = (p.totalDiamonds ?? 0) + diamonds;
    const s = this.session.get(platformId);
    if (s) s.diamonds += diamonds;
    this.dirty.add(platformId);
  }

  /** Bảng xếp hạng "phá Sếp": kim cương đã tặng giảm dần, rồi điểm, rồi số lượt tham gia. */
  leaderboard(scope: 'session' | 'total', limit = 10): LeaderboardEntry[] {
    const rows =
      scope === 'session'
        ? [...this.session.entries()].map(([id, s]) => ({
            p: this.players.get(id)!,
            participations: s.participations,
            points: s.points,
            diamonds: s.diamonds
          }))
        : [...this.players.values()].map((p) => ({
            p,
            participations: p.totalParticipations,
            points: p.totalPoints,
            diamonds: p.totalDiamonds ?? 0
          }));
    return rows
      .filter((r) => r.p && (scope === 'session' || !isDemoPlayer(r.p.platformId)))
      .sort((a, b) => b.diamonds - a.diamonds || b.points - a.points || b.participations - a.participations)
      .slice(0, limit)
      .map((r, i) => ({
        rank: i + 1,
        platformId: r.p.platformId,
        displayName: r.p.displayName,
        avatarUrl: r.p.avatarUrl,
        participations: r.participations,
        points: r.points,
        diamonds: r.diamonds,
        title: computeTitle(r.p)
      }));
  }

  resetSession(): void {
    this.session.clear();
    this.presence.clear();
  }

  /** Đánh dấu lại để lần lưu sau ghi tiếp (khi lần lưu trước lỗi). */
  markDirty(ids: string[]): void {
    ids.forEach((id) => this.dirty.add(id));
  }

  /** Lấy và xoá danh sách bản ghi cần lưu. Bỏ qua người chơi demo. */
  takeDirty(): { player: PlayerRecord; session: SessionStat | undefined }[] {
    const out: { player: PlayerRecord; session: SessionStat | undefined }[] = [];
    for (const id of this.dirty) {
      const player = this.players.get(id);
      if (player && !isDemoPlayer(id)) out.push({ player: { ...player }, session: this.session.get(id) });
    }
    this.dirty.clear();
    return out;
  }

  private upsert(user: LiveUser): PlayerRecord {
    let p = this.players.get(user.platformId);
    if (!p) {
      p = {
        platformId: user.platformId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        totalParticipations: 0,
        totalPoints: 0,
        totalDiamonds: 0,
        actionCounts: {},
        grantedTitles: []
      };
      this.players.set(user.platformId, p);
    } else {
      p.username = user.username;
      p.displayName = user.displayName;
      if (user.avatarUrl) p.avatarUrl = user.avatarUrl;
    }
    return p;
  }
}
