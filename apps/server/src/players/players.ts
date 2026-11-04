import { ROSTER_MAX, type LeaderboardEntry, type LiveUser, type PlayerTitle, type RosterMember } from '@cau/shared';
import { BIG_CATCH_KG, gramsToKg, kgToGrams } from '../engine/loot';

export interface PlayerRecord {
  platformId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  totalParticipations: number;
  totalPoints: number;
  /** Tổng kim cương đã tặng (toàn thời gian). Bản ghi cũ không có = 0. */
  totalDiamonds?: number;
  /** Tổng cân cá đã câu (gram, toàn thời gian). Bản ghi cũ không có = 0. */
  totalGrams?: number;
  /**
   * Bộ đếm dùng để tính danh hiệu: id hành động (quà), `work:<id>` (việc vui),
   * `catch` (số con câu tự động), `big_catch` (số con ≥ BIG_CATCH_KG), `big_fish` (cá to định kỳ).
   */
  actionCounts: Record<string, number>;
  /** Danh hiệu được trao từ sự kiện tập thể. */
  grantedTitles: string[];
}

export interface SessionStat {
  /** Kim cương đã tặng trong phiên. */
  diamonds: number;
  participations: number;
  points: number;
  /** Cân cá trong phiên (gram). */
  grams: number;
}

/** Người đang ngồi câu trong phiên — chỉ giữ trong bộ nhớ (không lưu DB). */
interface Presence {
  /** Thứ tự vào hồ (ổn định chỗ ngồi). */
  joinSeq: number;
  /** Số thứ tự tăng dần của lần bình luận / tặng quà gần nhất. */
  lastActive: number;
  /** Mốc thời gian (ms) của lần bình luận / tặng quà gần nhất — để mời rời hồ khi ngồi không quá lâu. */
  lastSeenAt: number;
  fishingMs: number;
  /** Số con câu tự động đã được trong lần ngồi này (0 = người mới, được ưu tiên con đầu tiên). */
  catches: number;
  /** Bờ đã gán (giữ nguyên khi vào/ra Bến Vàng; chỉ đổi khi cần cân lại hai bờ). */
  side: 'left' | 'right';
}

export const TITLES: Record<PlayerTitle['id'], string> = {
  rookie: 'Cần thủ tập sự',
  angler: 'Cần thủ chăm chỉ',
  big_catch: 'Sát thủ cá to',
  troll: 'Kẻ phá hồ',
  king_hunter: 'Kẻ săn Cá Thần'
};

/** Số con câu tự động để thành "Cần thủ chăm chỉ". */
export const ANGLER_MIN_CATCHES = 20;
/**
 * Số lượt việc vui bằng bình luận (`work:*`, miễn phí) để thành "Kẻ phá hồ".
 * KHÔNG tính lượt quà: danh hiệu không được là mốc thưởng cho việc tặng quà (chính sách TikTok LIVE).
 */
export const TROLL_MIN_WORK = 30;
/** Danh hiệu tập thể của bản cũ → danh hiệu mới. */
const LEGACY_GRANTED: Record<string, string> = { 'Nhân viên chống đối': TITLES.king_hunter };

/**
 * Danh hiệu, suy ra từ thống kê (không nhập tay). Thứ tự ưu tiên:
 * Kẻ phá hồ (≥ 30 lượt việc vui bằng bình luận) → danh hiệu tập thể (Kẻ săn Cá Thần) → Sát thủ cá to (từng có con ≥ 10 kg)
 * → Cần thủ chăm chỉ (≥ 20 con) → Cần thủ tập sự.
 */
export function computeTitle(p: Pick<PlayerRecord, 'actionCounts' | 'grantedTitles'>): string {
  const c = p.actionCounts;
  let work = 0;
  for (const [k, v] of Object.entries(c)) if (k.startsWith('work:')) work += v;
  if (work >= TROLL_MIN_WORK) return TITLES.troll;
  if (p.grantedTitles.length > 0) {
    const t = p.grantedTitles[p.grantedTitles.length - 1]!;
    return LEGACY_GRANTED[t] ?? t;
  }
  if ((c.big_catch ?? 0) > 0) return TITLES.big_catch;
  if ((c.catch ?? 0) >= ANGLER_MIN_CATCHES) return TITLES.angler;
  return TITLES.rookie;
}

export const isDemoPlayer = (platformId: string) => platformId.startsWith('demo:');

/**
 * `limit` phần tử đầu theo `cmp` (ổn định như sort: hoà giữ thứ tự gốc) mà không sắp xếp cả mảng —
 * bảng xếp hạng phát ~4 lần/giây, phiên chạy dài có thể có hàng chục nghìn người tham gia.
 */
export function topK<T>(rows: readonly T[], cmp: (a: T, b: T) => number, limit: number): T[] {
  if (limit <= 0) return [];
  if (rows.length <= limit * 4) return [...rows].sort(cmp).slice(0, limit);
  const top: T[] = [];
  for (const r of rows) {
    if (top.length === limit && cmp(r, top[limit - 1]!) >= 0) continue;
    let i = top.length;
    while (i > 0 && cmp(r, top[i - 1]!) < 0) i--;
    top.splice(i, 0, r);
    if (top.length > limit) top.pop();
  }
  return top;
}

/** Băm FNV-1a 32 bit — chia bờ trái / phải ổn định theo ID. */
export function sideFor(platformId: string): 'left' | 'right' {
  let h = 0x811c9dc5;
  for (let i = 0; i < platformId.length; i++) {
    h ^= platformId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2 === 0 ? 'left' : 'right';
}

/**
 * Quản lý cần thủ trong bộ nhớ: tổng hợp toàn thời gian + thống kê phiên + ai đang ngồi câu.
 * Thay đổi được đánh dấu "dirty" để lớp lưu trữ ghi xuống DB theo lô.
 */
export class PlayerRegistry {
  private players = new Map<string, PlayerRecord>();
  private session = new Map<string, SessionStat>();
  private dirty = new Set<string>();
  private presence = new Map<string, Presence>();
  private followers = new Set<string>();
  private activeSeq = 0;
  private joinSeq = 0;
  /** Thứ tự vào hồ của người vừa được cá thường (con trỏ xoay vòng). */
  private turnSeq = 0;
  /** Số ghế Bến Vàng (engine cập nhật theo `fishing.frontSeats`). */
  frontSeats = 5;
  /** Sức chứa của hồ (mặc định ROSTER_MAX; test có thể hạ xuống). */
  capacity = ROSTER_MAX;
  /** Người bị admin mời rời hồ → không tự vào lại bằng bình luận cho tới mốc này (tặng quà thì vẫn vào). */
  private kickedUntil = new Map<string, number>();

  load(records: PlayerRecord[]): void {
    for (const r of records) this.players.set(r.platformId, { ...r });
  }

  /**
   * Nạp lại thống kê phiên đang mở sau khi khởi động lại (bộ đếm phiên tiếp tục từ giá trị đã lưu, không từ 0 —
   * nếu không, lần lưu kế tiếp sẽ ghi đè số liệu phiên trong DB bằng số nhỏ hơn). Bỏ qua người không có trong bảng cần thủ.
   */
  loadSession(stats: readonly { playerId: string; stat: SessionStat }[]): void {
    for (const { playerId, stat } of stats) {
      if (!this.players.has(playerId)) continue;
      this.session.set(playerId, { ...stat });
    }
  }

  /** Ghi nhận một lượt tham gia (thống kê). Không tự đưa vào hồ — xem `join`. */
  participate(user: LiveUser, points: number, actionId?: string): PlayerRecord {
    const p = this.upsert(user);
    p.totalParticipations += 1;
    p.totalPoints += points;
    if (actionId) p.actionCounts[actionId] = (p.actionCounts[actionId] ?? 0) + 1;
    const s = this.sessionOf(p.platformId);
    s.participations += 1;
    s.points += points;
    this.dirty.add(p.platformId);
    // Đã thấy follow một lần thì giữ nguyên trong phiên (TikTok không phải lúc nào cũng gửi trạng thái).
    if (user.follower === true) this.followers.add(p.platformId);
    return p;
  }

  /**
   * Bình luận / tặng quà: vào hồ (hoặc làm mới thời điểm hoạt động nếu đã ngồi). Một món quà = một lượt hoạt động,
   * như một bình luận.
   * Hồ đầy (`ROSTER_MAX`) → người lâu không hoạt động nhất rời hồ, người mới ngồi vào. Trả về id người phải rời (nếu có).
   */
  join(platformId: string, now: number): string | null {
    if (!this.players.has(platformId)) return null;
    let evicted: string | null = null;
    let pr = this.presence.get(platformId);
    if (!pr) {
      // Bị admin mời rời hồ: chặn vào lại cho tới hết hạn — kể cả khi tặng quà (quà không mua được việc bỏ qua kiểm duyệt).
      if (this.isKicked(platformId, now)) return null;
      this.kickedUntil.delete(platformId);
      if (this.presence.size >= this.capacity) {
        // Người lâu không hoạt động nhất rời chỗ — ưu tiên người ĐÃ được ít nhất một con cá (người mới vào chưa kịp
        // câu không bị đẩy ra trắng tay). Một món quà chỉ tính là MỘT lượt hoạt động như một bình luận —
        // không giữ chỗ lâu hơn, không được ưu tiên (chính sách: quà không mua lợi thế giữ chỗ).
        let oldest: [string, Presence] | null = null;
        let oldestCaught: [string, Presence] | null = null;
        for (const e of this.presence) {
          if (!oldest || e[1].lastActive < oldest[1].lastActive) oldest = e;
          if (e[1].catches > 0 && (!oldestCaught || e[1].lastActive < oldestCaught[1].lastActive)) oldestCaught = e;
        }
        oldest = oldestCaught ?? oldest;
        if (oldest) {
          this.presence.delete(oldest[0]);
          evicted = oldest[0];
        }
      }
      pr = { joinSeq: ++this.joinSeq, lastActive: 0, lastSeenAt: now, fishingMs: 0, catches: 0, side: this.emptierSide(platformId) };
      this.presence.set(platformId, pr);
    }
    pr.lastActive = ++this.activeSeq;
    pr.lastSeenAt = now;
    return evicted;
  }

  /** Bờ đang ít người hơn; bằng nhau thì theo băm ID. */
  private emptierSide(platformId: string): 'left' | 'right' {
    let left = 0;
    let right = 0;
    for (const pr of this.presence.values()) pr.side === 'left' ? left++ : right++;
    if (left !== right) return left < right ? 'left' : 'right';
    return sideFor(platformId);
  }

  /** Mời rời hồ những người không bình luận / tặng quà quá `idleMs` (0 = không bao giờ). Trả về id đã rời. */
  kickIdle(now: number, idleMs: number): string[] {
    // Dọn mốc chặn vào lại đã hết hạn (không để map phình khi chạy 24/7 không reset phiên).
    for (const [id, until] of this.kickedUntil) if (now >= until) this.kickedUntil.delete(id);
    if (!(idleMs > 0)) return [];
    const out: string[] = [];
    for (const [id, pr] of this.presence) {
      if (now - pr.lastSeenAt > idleMs) {
        this.presence.delete(id);
        out.push(id);
      }
    }
    return out;
  }

  /**
   * Admin mời một người rời hồ. Trong `blockMs` tới người đó không vào lại hồ (bình luận hay tặng quà đều không;
   * quà vẫn được ghi nhận điểm/cân nhưng không hiện tên lên overlay). Trả về false nếu người đó không đang ngồi.
   */
  kick(platformId: string, now: number, blockMs: number): boolean {
    if (!this.presence.delete(platformId)) return false;
    if (blockMs > 0) this.kickedUntil.set(platformId, now + blockMs);
    return true;
  }

  /** Đang trong thời gian bị admin mời rời hồ. */
  isKicked(platformId: string, now: number): boolean {
    const until = this.kickedUntil.get(platformId);
    return until !== undefined && now < until;
  }

  /**
   * Gỡ hẳn những người thoả `pred` khỏi phiên: rời hồ, khỏi bảng phiên, follow, chặn, và khỏi bộ nhớ
   * (dùng để xoá người chơi demo khi chuyển sang LIVE thật). Trả về số người đã gỡ.
   */
  purge(pred: (platformId: string) => boolean): number {
    let n = 0;
    for (const id of [...this.players.keys()]) {
      if (!pred(id)) continue;
      this.players.delete(id);
      this.session.delete(id);
      this.presence.delete(id);
      this.followers.delete(id);
      this.kickedUntil.delete(id);
      this.dirty.delete(id);
      n++;
    }
    return n;
  }

  /** Người sẽ tới lượt cá thường ở chu kỳ tới (không dịch con trỏ). */
  peekNextInTurn(): string | null {
    let first: [string, Presence] | null = null;
    let next: [string, Presence] | null = null;
    for (const e of this.presence) {
      if (!first || e[1].joinSeq < first[1].joinSeq) first = e;
      if (e[1].joinSeq > this.turnSeq && (!next || e[1].joinSeq < next[1].joinSeq)) next = e;
    }
    return (next ?? first)?.[0] ?? null;
  }

  /** Đánh dấu đã follow (sự kiện follow) → lên cần thủ chính thức. Trả về true nếu thay đổi. */
  markFollower(platformId: string): boolean {
    if (this.followers.has(platformId)) return false;
    this.followers.add(platformId);
    return true;
  }

  /** Đã follow trong phiên này (theo trạng thái TikTok báo hoặc sự kiện follow). */
  isFollower(platformId: string): boolean {
    return this.followers.has(platformId);
  }

  isSeated(platformId: string): boolean {
    return this.presence.has(platformId);
  }

  /** Người đang ngồi câu (sức chứa đã giới hạn khi vào hồ). */
  private seated(): [string, Presence][] {
    return [...this.presence.entries()];
  }

  /** Id những người đang ngồi câu. */
  seatedIds(): string[] {
    return [...this.presence.keys()];
  }

  /**
   * Người tới lượt cá cắn câu: xoay vòng theo thứ tự vào hồ. Người mới vào xếp cuối; người rời hồ bị bỏ qua
   * mà không làm lệch thứ tự (con trỏ là thứ tự vào hồ của người vừa được cá). Hết vòng thì quay lại người đầu.
   */
  nextInTurn(): string | null {
    const id = this.peekNextInTurn();
    if (id === null) return null;
    this.turnSeq = this.presence.get(id)!.joinSeq;
    return id;
  }

  /** Người đang ngồi chưa được con cá nào (theo thứ tự vào hồ) — được ưu tiên con đầu tiên ở chu kỳ kế. */
  uncaughtSeated(): string[] {
    return [...this.presence.entries()]
      .filter(([, pr]) => pr.catches === 0)
      .sort((a, b) => a[1].joinSeq - b[1].joinSeq)
      .map(([id]) => id);
  }

  /** Ghi nhận một con câu tự động cho người đang ngồi. */
  markCaught(platformId: string): void {
    const pr = this.presence.get(platformId);
    if (pr) pr.catches += 1;
  }

  /**
   * Tim / share / follow của người ĐANG ngồi: làm mới thời gian hoạt động (không mời rời hồ vì ngồi không).
   * Không đưa người mới vào hồ. Trả về true nếu người đó đang ngồi.
   */
  touch(platformId: string, now: number): boolean {
    const pr = this.presence.get(platformId);
    if (!pr) return false;
    pr.lastActive = ++this.activeSeq;
    pr.lastSeenAt = now;
    return true;
  }

  /** Làm mới mốc hoạt động của mọi người đang ngồi (khi LIVE quay lại sau lúc tạm dừng — không mời rời hồ oan). */
  refreshSeen(now: number): void {
    for (const pr of this.presence.values()) pr.lastSeenAt = now;
  }

  /** Cộng thời gian ngồi câu cho những người đang ngồi. */
  addFishingMs(ids: readonly string[], ms: number): void {
    for (const id of ids) {
      const pr = this.presence.get(id);
      if (pr) pr.fishingMs += ms;
    }
  }

  /**
   * Danh sách chỗ ngồi quanh hồ. `frontSeats` người tặng quà nhiều nhất trong phiên (hoà: câu lâu hơn,
   * rồi vào hồ trước) ngồi Bến Vàng; còn lại chia đều hai bờ — mỗi người giữ bờ đã gán, chỉ khi hai bờ
   * lệch nhau quá 1 người thì người vào hồ muộn nhất ở bờ đông được chuyển sang bờ vắng.
   * Bến Vàng đứng đầu danh sách theo thứ hạng, sau đó là hai bờ theo thứ tự vào hồ.
   */
  roster(): RosterMember[] {
    const seated = this.seated();
    const diamondsOf = (id: string) => this.session.get(id)?.diamonds ?? 0;
    const ranked = [...seated].sort(
      (a, b) => diamondsOf(b[0]) - diamondsOf(a[0]) || b[1].fishingMs - a[1].fishingMs || a[1].joinSeq - b[1].joinSeq
    );
    const front = ranked.slice(0, Math.max(0, this.frontSeats));
    const frontIds = new Set(front.map(([id]) => id));
    const rest = seated.filter(([id]) => !frontIds.has(id)).sort((a, b) => a[1].joinSeq - b[1].joinSeq);
    // Cân hai bờ: chuyển người vào muộn nhất từ bờ đông sang bờ vắng cho tới khi lệch ≤ 1.
    for (;;) {
      const left = rest.filter((e) => e[1].side === 'left');
      const right = rest.filter((e) => e[1].side === 'right');
      if (Math.abs(left.length - right.length) <= 1) break;
      const from = left.length > right.length ? left : right;
      from[from.length - 1]![1].side = from === left ? 'right' : 'left';
    }
    const member = ([id, pr]: [string, Presence], seat: RosterMember['seat']): RosterMember => {
      const p = this.players.get(id)!;
      const s = this.session.get(id);
      return {
        platformId: id,
        displayName: p.displayName,
        follower: this.followers.has(id),
        points: s?.points ?? 0,
        seat,
        kg: gramsToKg(s?.grams ?? 0),
        fishingMs: pr.fishingMs,
        diamonds: s?.diamonds ?? 0
      };
    };
    return [...front.map((e) => member(e, 'front')), ...rest.map((e) => member(e, e[1].side))];
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

  /**
   * Cộng một con cá (câu tự động, kéo cá to, phần chia Cá Thần): cân + điểm, tăng bộ đếm `countKey` (nếu có)
   * và `big_catch` khi con cá ≥ BIG_CATCH_KG.
   */
  creditFish(platformId: string, kg: number, points: number, countKey?: string, countsForTitle = true): void {
    const p = this.players.get(platformId);
    if (!p) return;
    const grams = kgToGrams(kg);
    p.totalGrams = (p.totalGrams ?? 0) + grams;
    p.totalPoints += points;
    if (countKey) p.actionCounts[countKey] = (p.actionCounts[countKey] ?? 0) + 1;
    // Cá từ quà (`countsForTitle = false`) không tính vào danh hiệu "Sát thủ cá to" — danh hiệu không là mốc thưởng cho quà.
    if (countsForTitle && kg >= BIG_CATCH_KG) p.actionCounts.big_catch = (p.actionCounts.big_catch ?? 0) + 1;
    const s = this.sessionOf(platformId);
    s.grams += grams;
    s.points += points;
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

  sessionStat(platformId: string): SessionStat | undefined {
    return this.session.get(platformId);
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

  private rows(scope: 'session' | 'total') {
    const rows =
      scope === 'session'
        ? [...this.session.entries()].map(([id, s]) => ({
            p: this.players.get(id)!,
            participations: s.participations,
            points: s.points,
            diamonds: s.diamonds,
            grams: s.grams
          }))
        : [...this.players.values()].map((p) => ({
            p,
            participations: p.totalParticipations,
            points: p.totalPoints,
            diamonds: p.totalDiamonds ?? 0,
            grams: p.totalGrams ?? 0
          }));
    // Bảng phiên (lên overlay) ẩn người đang bị admin mời rời hồ (mốc hết hạn được dọn mỗi tick trong kickIdle);
    // bảng toàn thời gian bỏ người chơi demo.
    return rows.filter((r) => r.p && (scope === 'session' ? !this.kickedUntil.has(r.p.platformId) : !isDemoPlayer(r.p.platformId)));
  }

  private entries(rows: ReturnType<PlayerRegistry['rows']>, limit: number): LeaderboardEntry[] {
    return rows.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      platformId: r.p.platformId,
      displayName: r.p.displayName,
      avatarUrl: r.p.avatarUrl,
      participations: r.participations,
      points: r.points,
      diamonds: r.diamonds,
      kg: gramsToKg(r.grams),
      title: computeTitle(r.p)
    }));
  }

  /** TOP QUÀ TẶNG: kim cương đã tặng giảm dần, rồi điểm, rồi số lượt tham gia. */
  leaderboard(scope: 'session' | 'total', limit = 10): LeaderboardEntry[] {
    const rows = topK(
      this.rows(scope),
      (a, b) => b.diamonds - a.diamonds || b.points - a.points || b.participations - a.participations,
      limit
    );
    return this.entries(rows, limit);
  }

  /** BẢNG CÂN CÁ: tổng cân giảm dần (chỉ người đã có cá), rồi điểm, rồi số lượt tham gia. */
  kgBoard(scope: 'session' | 'total', limit = 10): LeaderboardEntry[] {
    const rows = topK(
      this.rows(scope).filter((r) => r.grams > 0),
      (a, b) => b.grams - a.grams || b.points - a.points || b.participations - a.participations,
      limit
    );
    return this.entries(rows, limit);
  }

  resetSession(): void {
    this.session.clear();
    this.presence.clear();
    this.followers.clear();
    this.kickedUntil.clear();
    this.turnSeq = 0;
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
      const session = this.session.get(id);
      if (player && !isDemoPlayer(id)) out.push({ player: { ...player }, session: session ? { ...session } : undefined });
    }
    this.dirty.clear();
    return out;
  }

  private sessionOf(platformId: string): SessionStat {
    let s = this.session.get(platformId);
    if (!s) {
      s = { participations: 0, points: 0, diamonds: 0, grams: 0 };
      this.session.set(platformId, s);
    }
    return s;
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
        totalGrams: 0,
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
