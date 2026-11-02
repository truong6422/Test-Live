import { MOOD_LABELS, type BossState, type CollectiveState, type ConnectorInfo, type FeedItem, type LeaderboardEntry, type RunningAction } from '@sep/shared';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const MOOD_EMOJI = { normal: '🙂', annoyed: '😒', angry: '😡', panic: '😱', helpless: '😵' } as const;
const ACTION_EMOJI: Record<string, string> = {
  throw_paper: '🗞️',
  pluck_tree: '🌿',
  doodle_kpi: '🖍️',
  flat_tire: '🚗',
  blackout: '🔌',
  lock_toilet: '🚽',
  strike: '✊'
};

/** Tạo avatar an toàn: ảnh https hoặc chữ cái đầu. Không dùng innerHTML với dữ liệu người xem. */
function avatar(name: string, url: string | undefined, small = false): HTMLElement {
  if (url && url.startsWith('https://')) {
    const img = document.createElement('img');
    img.className = small ? 'avatar small' : 'avatar';
    img.src = url;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => img.replaceWith(avatar(name, undefined, small));
    return img;
  }
  const span = document.createElement('span');
  span.className = `avatar initial${small ? ' small' : ''}`;
  span.textContent = [...name.trim()][0]?.toUpperCase() ?? '?';
  return span;
}

/** 1234 → "1,2K" cho gọn trên điện thoại. */
function fmt(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}K` : String(n);
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Hud {
  private lastFeedId: string | null = null;
  private lastHintAt = 0;

  boss(b: BossState): void {
    const calm = Math.round(b.calm);
    const stamina = Math.round(b.stamina);
    $('bar-calm').style.width = `${calm}%`;
    $('bar-calm').style.backgroundColor = calm >= 60 ? '#2ec27e' : calm >= 35 ? '#f5c211' : '#e01b24';
    $('bar-stamina').style.width = `${stamina}%`;
    $('val-calm').textContent = String(calm);
    $('val-stamina').textContent = String(stamina);
    $('mood-label').textContent = MOOD_LABELS[b.mood];
    $('mood-emoji').textContent = MOOD_EMOJI[b.mood];
  }

  actionStarted(run: RunningAction): void {
    const who = run.actor?.displayName ?? 'Cả công ty';
    const emoji = ACTION_EMOJI[run.actionId] ?? '⚡';
    const last = $('last-action');
    last.textContent = '';
    last.append(`${emoji} Vừa xong: `, el('b', '', who), ` — ${run.actionName}`);

    this.toast(
      run.source === 'collective' ? 'toast collective' : 'toast',
      run.actor ? run.actor.avatarUrl ?? '' : null,
      who,
      `${emoji} ${run.actionName}`,
      Math.min(run.durationMs, 4000)
    );
  }

  /** avatarUrl: null = không hiện avatar; '' = avatar chữ cái đầu. */
  private toast(cls: string, avatarUrl: string | null, who: string, text: string, ttl: number): void {
    const toast = el('div', cls);
    if (avatarUrl !== null) toast.append(avatar(who, avatarUrl || undefined));
    toast.append(el('span', 'who', who), el('span', '', text));
    const box = $('toasts');
    box.prepend(toast);
    while (box.children.length > 2) box.lastElementChild?.remove();
    setTimeout(() => toast.classList.add('out'), ttl);
    setTimeout(() => toast.remove(), ttl + 320);
  }

  /** Bảng tin đã bỏ khỏi overlay; chỉ còn gợi ý "follow để lên chính thức" hiện thành thông báo ngắn. */
  feed(items: FeedItem[]): void {
    const prev = this.lastFeedId;
    this.lastFeedId = items[0]?.id ?? null;
    if (prev === null) return; // lần đầu (snapshot): không bắn lại thông báo cũ
    for (const it of items) {
      if (it.id === prev) break;
      if (it.actionId === null && it.text.startsWith('Follow kênh')) {
        const now = Date.now();
        if (now - this.lastHintAt < 8000) return;
        this.lastHintAt = now;
        this.toast('toast hint', null, it.actorName, `👔 ${it.text}`, 5000);
        return;
      }
    }
  }

  private boardSig = '';

  /** Bảng TOP PHÁ SẾP: 3 người tặng quà (kim cương) nhiều nhất phiên này. Chỉ vẽ lại khi thay đổi. */
  leaderboard(entries: (LeaderboardEntry & { diamonds?: number })[], _participants: number): void {
    const top = entries.filter((e) => (e.diamonds ?? 0) > 0).slice(0, 3);
    const sig = top.map((e) => `${e.platformId}:${e.displayName}:${e.diamonds}`).join('|');
    if (sig === this.boardSig) return;
    this.boardSig = sig;
    const list = $('board-list');
    list.replaceChildren();
    if (!top.length) {
      list.append(el('li', 'empty', 'Chưa ai dám phá Sếp… 🎁'));
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    top.forEach((e, i) => {
      const li = el('li', '');
      li.append(el('span', 'rank', medals[i]!), avatar(e.displayName, e.avatarUrl, true), el('span', 'name', e.displayName), el('span', 'gems', `💎${fmt(e.diamonds ?? 0)}`));
      list.append(li);
    });
  }

  collective(c: CollectiveState | null): void {
    const box = $('collective');
    box.hidden = !c;
    if (!c) return;
    box.classList.toggle('done', c.status === 'completed');
    $('collective-name').textContent = c.status === 'completed' ? `✊ ${c.name} — THÀNH CÔNG!` : `✊ ${c.name}`;
    $('collective-count').textContent = `${c.progress} / ${c.goal} · ${c.participants} người`;
    $('collective-fill').style.width = `${Math.round((c.progress / Math.max(1, c.goal)) * 100)}%`;
    $('collective-desc').textContent = c.status === 'completed' ? 'Vòng mới sẽ bắt đầu ngay sau đây…' : c.description;
  }

  connectors(info: ConnectorInfo): void {
    $('badge-demo').hidden = !info.demo.running;
    $('badge-live').hidden = info.tiktok.status !== 'connected';
  }

  running(r: boolean): void {
    $('badge-paused').hidden = r;
  }

  connection(ok: boolean, msg = 'Mất kết nối máy chủ, đang thử lại…'): void {
    const e = $('conn-error');
    e.hidden = ok;
    e.textContent = msg;
  }
}
