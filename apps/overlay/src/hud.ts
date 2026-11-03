import type { CollectiveState, ConnectorInfo, FeedItem, KingState, LeaderboardEntry, RunningAction } from '@cau/shared';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ACTION_EMOJI: Record<string, string> = {
  pull_koi: '🎏',
  pull_carp: '🐟',
  pull_grass_carp: '🐠',
  pull_catfish: '🐡',
  pull_snakehead: '🐟',
  pull_giant_catfish: '🦈',
  pull_arowana: '🐉',
  pull_stingray: '🦈',
  pull_legend: '👑',
  big_fish_event: '🐋',
  grand_haul: '🪢'
};

/** Chữ hiển thị không dùng từ ngữ may rủi (chính sách TikTok). */
const clean = (name: string) => name.replace(/\s*may mắn/gi, '').trim();

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

/** Cân nặng: 12.5 → "12,5kg"; ≥ 1000 → "1,2 tấn". */
function fmtKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1).replace('.', ',')} tấn`;
  return `${(Math.round(kg * 10) / 10).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}kg`;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export class Hud {
  private lastFeedId: string | null = null;
  private lastHintAt = 0;
  private giftSig = '';
  private kgSig = '';
  private bigFishAt = 0;
  private bigFishTimer: ReturnType<typeof setInterval> | null = null;

  /** Giữ để tương thích: HUD không còn hiển thị thanh Cá Thần. */
  king(_state: KingState): void {}

  actionStarted(run: RunningAction): void {
    const who = run.actor?.displayName ?? 'Cả hồ';
    const emoji = run.fish?.emoji ?? ACTION_EMOJI[run.actionId] ?? '🎣';
    const what = run.fish ? `kéo được ${run.fish.emoji} ${clean(run.fish.name)} ${fmtKg(run.fish.kg)}!` : clean(run.actionName);
    const last = $('last-action');
    last.textContent = '';
    last.append(`${emoji} `, el('b', '', who), ` ${what}`);

    this.toast(
      run.source === 'collective' ? 'toast collective' : 'toast',
      run.actor ? run.actor.avatarUrl ?? '' : null,
      who,
      run.fish ? `${run.fish.emoji} ${clean(run.fish.name)} · ${fmtKg(run.fish.kg)}` : `${emoji} ${clean(run.actionName)}`,
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

  /** Bảng tin không hiện trên overlay; chỉ gợi ý "follow để thành cần thủ chính thức" hiện thành thông báo ngắn. */
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
        this.toast('toast hint', null, it.actorName, `👒 ${it.text}`, 5000);
        return;
      }
    }
  }

  /**
   * Hai bảng: TOP QUÀ TẶNG (theo 💎, chỉ người đã tặng) và BẢNG CÂN CÁ (theo kg).
   * Mỗi bảng chỉ vẽ lại khi thay đổi.
   */
  leaderboard(entries: LeaderboardEntry[], _participants: number, kgBoard: LeaderboardEntry[] = []): void {
    const gifts = entries.filter((e) => (e.diamonds ?? 0) > 0).slice(0, 3);
    const gSig = gifts.map((e) => `${e.platformId}:${e.displayName}:${e.diamonds}`).join('|');
    if (gSig !== this.giftSig) {
      this.giftSig = gSig;
      this.fillBoard($('gift-list'), gifts, (e) => `💎${fmt(e.diamonds ?? 0)}`, 'Chưa có quà nào 🎁');
    }
    const kgs = kgBoard.filter((e) => (e.kg ?? 0) > 0).slice(0, 3);
    const kSig = kgs.map((e) => `${e.platformId}:${e.displayName}:${e.kg}`).join('|');
    if (kSig !== this.kgSig) {
      this.kgSig = kSig;
      this.fillBoard($('kg-list'), kgs, (e) => `⚖️${fmtKg(e.kg ?? 0)}`, 'Chưa ai lên cá… 🎣');
    }
  }

  private fillBoard(list: HTMLElement, rows: LeaderboardEntry[], value: (e: LeaderboardEntry) => string, empty: string): void {
    list.replaceChildren();
    if (!rows.length) {
      list.append(el('li', 'empty', empty));
      return;
    }
    rows.forEach((e, i) => {
      const li = el('li', '');
      li.append(el('span', 'rank', MEDALS[i]!), avatar(e.displayName, e.avatarUrl, true), el('span', 'name', e.displayName), el('span', 'val', value(e)));
      list.append(li);
    });
  }

  /** Đếm ngược "Cá to xuất hiện sau mm:ss" (sự kiện miễn phí định kỳ). at = 0 → ẩn. */
  bigFishNext(at: number): void {
    this.bigFishAt = at;
    const render = () => {
      const box = $('bigfish');
      if (!this.bigFishAt) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      const left = Math.max(0, Math.ceil((this.bigFishAt - Date.now()) / 1000));
      const mm = String(Math.floor(left / 60)).padStart(2, '0');
      const ss = String(left % 60).padStart(2, '0');
      $('bigfish-text').textContent = left > 0 ? `Cá to xuất hiện sau ${mm}:${ss}` : 'Cá to đang lên!';
    };
    render();
    if (at && !this.bigFishTimer) this.bigFishTimer = setInterval(render, 1000);
    if (!at && this.bigFishTimer) {
      clearInterval(this.bigFishTimer);
      this.bigFishTimer = null;
    }
  }

  collective(c: CollectiveState | null): void {
    const box = $('collective');
    box.hidden = !c;
    if (!c) return;
    box.classList.toggle('done', c.status === 'completed');
    $('collective-name').textContent = c.status === 'completed' ? `🪢 ${c.name} — THÀNH CÔNG!` : `🪢 ${c.name}`;
    $('collective-count').textContent = `${c.progress} / ${c.goal} · ${c.participants} người`;
    $('collective-fill').style.width = `${Math.round((c.progress / Math.max(1, c.goal)) * 100)}%`;
    $('collective-desc').textContent = c.status === 'completed' ? 'Vòng mới sẽ bắt đầu ngay sau đây…' : c.description;
  }

  connectors(info: ConnectorInfo): void {
    $('badge-demo').hidden = !info.demo.running;
    $('demo-ribbon').hidden = !info.demo.running;
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
