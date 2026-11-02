import type { LiveUser, NormalizedEvent } from '@sep/shared';
import { cleanAvatarUrl, cleanComment, cleanDisplayName } from './sanitize';

/**
 * Hình dạng tối thiểu của message từ tiktok-live-connector v2 (schema tiktok-live-proto v3).
 * Chỉ khai báo trường dùng tới — mọi trường đều optional vì TikTok có thể đổi/thiếu dữ liệu.
 */
export interface TtImage {
  urlList?: string[];
}
export interface TtUser {
  id?: string;
  displayId?: string;
  nickname?: string;
  avatarThumb?: TtImage;
  avatarMedium?: TtImage;
  /** followStatus: 0 = chưa follow chủ phòng, 1 = đã follow, 2 = bạn bè (follow 2 chiều). */
  followInfo?: { followStatus?: string | number };
}
export interface TtCommon {
  msgId?: string;
  createTime?: string;
}
export interface TtChat {
  common?: TtCommon;
  user?: TtUser;
  content?: string;
  userIdentity?: { isFollowerOfAnchor?: boolean; isMutualFollowingWithAnchor?: boolean };
}
export interface TtLike {
  common?: TtCommon;
  user?: TtUser;
  count?: number;
}
export interface TtSocial {
  common?: TtCommon;
  user?: TtUser;
}
export interface TtGift {
  common?: TtCommon;
  user?: TtUser;
  giftId?: string | number;
  repeatCount?: number;
  comboCount?: number;
  repeatEnd?: number | boolean;
  groupId?: string;
  gift?: { name?: string; diamondCount?: number; type?: number; combo?: boolean };
  extendedGiftInfo?: { name?: string; diamond_count?: number; type?: number };
}

interface Streak {
  key: string;
  user: LiveUser;
  giftId: number;
  name: string;
  diamonds: number;
  count: number;
  lastAt: number;
  firstMsgId: string;
}

export interface NormalizerOptions {
  /** Streak không có repeatEnd sau thời gian này sẽ được tự chốt. */
  streakTimeoutMs?: number;
}

/**
 * Chuẩn hoá message TikTok -> NormalizedEvent.
 *
 * Gift streak: với quà combo (gift.type === 1 hoặc gift.combo), TikTok gửi nhiều message
 * với repeatCount tăng dần và message cuối có repeatEnd = 1. Ta CHỈ phát một sự kiện khi
 * streak kết thúc, với count = repeatCount cuối. Quà không combo phát ngay.
 * Nếu repeatEnd không bao giờ tới (mất kết nối giữa chừng), flushStale() chốt streak sau timeout;
 * repeatEnd tới muộn sau đó sẽ bị bỏ qua để không đếm hai lần.
 */
export class TikTokNormalizer {
  private streaks = new Map<string, Streak>();
  private finalized = new Map<string, number>();
  private readonly streakTimeoutMs: number;

  constructor(opts: NormalizerOptions = {}) {
    this.streakTimeoutMs = opts.streakTimeoutMs ?? 10_000;
  }

  user(u: TtUser | undefined, identity?: TtChat['userIdentity']): LiveUser | null {
    const platformId = u?.id ? String(u.id) : '';
    const username = String(u?.displayId ?? '').trim();
    if (!platformId && !username) return null;
    return {
      platformId: platformId || `u:${username}`,
      username: username || platformId,
      displayName: cleanDisplayName(u?.nickname, username || 'Nhân viên ẩn danh'),
      avatarUrl: cleanAvatarUrl(u?.avatarThumb?.urlList?.[0] ?? u?.avatarMedium?.urlList?.[0]),
      follower: followerOf(u, identity)
    };
  }

  chat(d: TtChat, now: number): NormalizedEvent | null {
    const user = this.user(d.user, d.userIdentity);
    const text = cleanComment(d.content);
    if (!user || !text) return null;
    return { id: this.id('chat', d.common, user, now), source: 'tiktok', kind: 'comment', user, receivedAt: now, text };
  }

  like(d: TtLike, now: number): NormalizedEvent | null {
    const user = this.user(d.user);
    if (!user) return null;
    return {
      id: this.id('like', d.common, user, now),
      source: 'tiktok',
      kind: 'like',
      user,
      receivedAt: now,
      likeCount: Math.max(1, Number(d.count) || 1)
    };
  }

  social(kind: 'share' | 'follow', d: TtSocial, now: number): NormalizedEvent | null {
    const user = this.user(d.user);
    if (!user) return null;
    return { id: this.id(kind, d.common, user, now), source: 'tiktok', kind, user, receivedAt: now };
  }

  gift(d: TtGift, now: number): NormalizedEvent | null {
    const user = this.user(d.user);
    const giftId = Number(d.giftId);
    if (!user || !Number.isFinite(giftId)) return null;
    const name = cleanDisplayName(d.gift?.name ?? d.extendedGiftInfo?.name, `Quà #${giftId}`);
    const diamonds = Math.max(0, Number(d.gift?.diamondCount ?? d.extendedGiftInfo?.diamond_count ?? 0) || 0);
    const repeat = Math.max(1, Number(d.repeatCount) || Number(d.comboCount) || 1);
    const streakable = d.gift?.type === 1 || d.gift?.combo === true || d.extendedGiftInfo?.type === 1;
    const ended = d.repeatEnd === true || Number(d.repeatEnd) === 1;
    const msgId = d.common?.msgId;

    if (!streakable) {
      return {
        id: msgId ? `tt:${msgId}` : `gift:${user.platformId}:${giftId}:${now}`,
        source: 'tiktok',
        kind: 'gift',
        user,
        receivedAt: now,
        gift: { giftId, name, count: repeat, diamonds }
      };
    }

    const key = `${user.platformId}:${d.groupId && d.groupId !== '0' ? d.groupId : giftId}`;
    if (this.finalized.has(key)) {
      // streak đã được chốt (do timeout) — bỏ qua message tới muộn
      if (ended) this.finalized.delete(key);
      return null;
    }
    const prev = this.streaks.get(key);
    const streak: Streak = prev ?? { key, user, giftId, name, diamonds, count: 0, lastAt: now, firstMsgId: msgId ?? key };
    streak.count = Math.max(streak.count, repeat);
    streak.lastAt = now;
    streak.user = user;

    if (!ended) {
      this.streaks.set(key, streak);
      return null;
    }
    this.streaks.delete(key);
    return this.streakEvent(streak, now, msgId ? `tt:${msgId}` : `streak:${key}:${streak.count}`);
  }

  /** Chốt các streak quá hạn (gọi định kỳ). */
  flushStale(now: number): NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    for (const [key, s] of this.streaks) {
      if (now - s.lastAt < this.streakTimeoutMs) continue;
      this.streaks.delete(key);
      this.finalized.set(key, now);
      out.push(this.streakEvent(s, now, `streak:${key}:${s.firstMsgId}`));
    }
    for (const [key, at] of this.finalized) {
      if (now - at > 5 * 60_000) this.finalized.delete(key);
    }
    return out;
  }

  get pendingStreaks(): number {
    return this.streaks.size;
  }

  private streakEvent(s: Streak, now: number, id: string): NormalizedEvent {
    return {
      id,
      source: 'tiktok',
      kind: 'gift',
      user: s.user,
      receivedAt: now,
      gift: { giftId: s.giftId, name: s.name, count: s.count, diamonds: s.diamonds }
    };
  }

  private id(kind: string, common: TtCommon | undefined, user: LiveUser, now: number): string {
    // msgId là khoá chống trùng chính; thiếu msgId thì dùng tổ hợp (ít tin cậy hơn).
    return common?.msgId ? `tt:${common.msgId}` : `tt:${kind}:${user.platformId}:${common?.createTime ?? now}`;
  }
}

/** Lấy @username từ "@name", "name" hoặc link tiktok.com/@name/live. Không gọi mạng. */
export function parseTikTokUsername(input: string): string | null {
  const raw = input.trim();
  const fromUrl = raw.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
  const name = (fromUrl?.[1] ?? raw.replace(/^@/, '')).trim();
  return /^[A-Za-z0-9._]{2,24}$/.test(name) ? name : null;
}

/** Người xem đã follow chủ phòng chưa. undefined = TikTok không gửi thông tin. */
function followerOf(u: TtUser | undefined, identity: TtChat['userIdentity']): boolean | undefined {
  if (identity?.isFollowerOfAnchor || identity?.isMutualFollowingWithAnchor) return true;
  const status = u?.followInfo?.followStatus;
  if (status === undefined || status === '') return identity ? false : undefined;
  return Number(status) >= 1;
}
