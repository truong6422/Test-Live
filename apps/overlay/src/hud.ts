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
const clean = (name: string) => name.replace(/\s*(may mắn|ngẫu nhiên|bí ẩn)/gi, '').trim();

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('vi', { granularity: 'grapheme' }) : null;

/** Ký tự đầu theo cụm (emoji ghép, cờ, chữ có dấu tổ hợp) — không cắt đôi thành ký tự lỗi. */
function firstGlyph(name: string): string {
  const s = name.trim();
  if (!s) return '?';
  const g = segmenter ? segmenter.segment(s)[Symbol.iterator]().next().value?.segment : [...s][0];
  return g?.toLocaleUpperCase('vi') || '?';
}

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
  span.textContent = firstGlyph(name);
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
/** Mỗi bảng chỉ 2 dòng: khối HUD phải kết thúc ≤ y 560 (người ngồi Bến Vàng ngay bên dưới) ở mọi trạng thái. */
const BOARD_ROWS = 2;
/** Lời mời + mẹo, lần lượt thay nhau trên một dòng của thẻ hướng dẫn. */
const GUIDE_LINES = [
  'Có ngay một ghế bên hồ, cá cắn câu lần lượt',
  '🎁 Mỗi quà kéo một loài cá cố định, không may rủi',
  '👒 Người theo dõi kênh đội nón lá',
  '🏆 Bến Vàng: cần thủ nổi bật của phiên'
];

export class Hud {
  private lastFeedId: string | null = null;
  private lastHintAt = 0;
  private giftSig: string | null = null;
  private kgSig: string | null = null;
  private bigFishAt = 0;
  private bigFishOffset = 0;
  private bigFishTimer: ReturnType<typeof setInterval> | null = null;
  private bigFishShown = '';
  private collectiveSig = '';
  /** Đang chạy dữ liệu giả lập: ẩn TOP QUÀ TẶNG (kim cương giả không được trông như "bằng chứng" người thật tặng quà). */
  private demo = false;
  private lastGifts: LeaderboardEntry[] = [];
  private tip = 0;

  constructor() {
    // Dòng thứ hai của thẻ hướng dẫn: lời mời + các mẹo thay nhau mỗi 5 giây (một nút chữ, không dựng lại DOM).
    const line = $('guide-line');
    setInterval(() => {
      this.tip = (this.tip + 1) % GUIDE_LINES.length;
      line.textContent = GUIDE_LINES[this.tip]!;
      line.className = `guide-line ${this.tip % 2 ? 'in-a' : 'in-b'}`;
    }, 5000);
  }

  /** Giữ để tương thích: HUD không còn hiển thị thanh Cá Thần. */
  king(_state: KingState): void {}

  actionStarted(run: RunningAction): void {
    const who = run.actor?.displayName ?? 'Cả hồ';
    const emoji = run.fish?.emoji ?? ACTION_EMOJI[run.actionId] ?? '🎣';
    // Chỉ nêu sự việc (ai · cá gì · bao nhiêu kg) — không kêu gọi tặng quà.
    this.toast(
      run.source === 'collective' ? 'toast collective' : 'toast',
      run.actor ? run.actor.avatarUrl ?? '' : null,
      who,
      run.fish ? `${run.fish.emoji} ${clean(run.fish.name)} · ${fmtKg(run.fish.kg)}` : `${emoji} ${clean(run.actionName)}`,
      Math.min(run.durationMs, 4000)
    );
  }

  /**
   * Một thẻ mỗi lúc: thẻ mới thay thẻ cũ (thẻ cũ mờ đi chồng ngay bên dưới, không đẩy dải xuống che người được zoom).
   * DOM tối đa 2 phần tử; mỗi thẻ đúng 1 hẹn giờ, tự huỷ khi bị thay sớm.
   * avatarUrl: null = không hiện avatar; '' = avatar chữ cái đầu.
   */
  private toast(cls: string, avatarUrl: string | null, who: string, text: string, ttl: number): void {
    const box = $('toasts');
    for (const old of Array.from(box.children)) old.classList.add('out');
    while (box.children.length > 1) box.firstElementChild?.remove();

    const toast = el('div', avatarUrl === null ? `${cls} no-avatar` : cls);
    if (avatarUrl !== null) toast.append(avatar(who, avatarUrl || undefined));
    toast.append(el('span', 'who', who), el('span', 'what', text));
    const timer = setTimeout(() => toast.classList.add('out'), ttl);
    toast.addEventListener('animationend', () => {
      if (!toast.classList.contains('out')) return;
      clearTimeout(timer);
      toast.remove();
    });
    box.append(toast);
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
    this.lastGifts = entries;
    this.renderGifts();
    const kgs = kgBoard.filter((e) => (e.kg ?? 0) > 0).slice(0, BOARD_ROWS);
    const kSig = kgs.map((e) => `${e.platformId}:${e.displayName}:${e.avatarUrl ?? ''}:${e.kg}`).join('|');
    if (kSig !== this.kgSig) {
      this.kgSig = kSig;
      this.fillBoard($('kg-list'), kgs, (e) => fmtKg(e.kg ?? 0));
    }
  }

  private renderGifts(): void {
    const gifts = this.demo ? [] : this.lastGifts.filter((e) => (e.diamonds ?? 0) > 0).slice(0, BOARD_ROWS);
    const gSig = gifts.map((e) => `${e.platformId}:${e.displayName}:${e.avatarUrl ?? ''}:${e.diamonds}`).join('|');
    if (gSig !== this.giftSig) {
      this.giftSig = gSig;
      this.fillBoard($('gift-list'), gifts, (e) => `💎${fmt(e.diamonds ?? 0)}`);
    }
  }

  /** Bảng trống thì ẩn hẳn (đỡ rối, cũng tránh câu kiểu "chưa có quà" như mời tặng quà); cả hai trống thì ẩn khối bảng. */
  private fillBoard(list: HTMLElement, rows: LeaderboardEntry[], value: (e: LeaderboardEntry) => string): void {
    list.closest('.board')?.classList.toggle('is-empty', !rows.length);
    $('boards').hidden = !document.querySelector('#boards .board:not(.is-empty)');
    list.replaceChildren(
      ...rows.map((e, i) => {
        const li = el('li', '');
        li.append(el('span', 'rank', MEDALS[i]!), avatar(e.displayName, e.avatarUrl, true), el('span', 'name', e.displayName), el('span', 'val', value(e)));
        return li;
      })
    );
  }

  /**
   * Đếm ngược "Cá to sau mm:ss" (sự kiện MIỄN PHÍ định kỳ, không gắn với quà). at = 0 → ẩn.
   * clockOffset = giờ server − giờ máy (main.ts có sẵn bigFish.clockOffset), để đồng hồ khớp server.
   * Mỗi giây chỉ đổi textContent của 1 nút chữ, và chỉ khi chuỗi đổi; hết giờ thì dừng hẹn giờ.
   */
  bigFishNext(at: number, clockOffset = this.bigFishOffset): void {
    this.bigFishAt = at;
    this.bigFishOffset = clockOffset;
    const box = $('bigfish');
    if (!at) {
      box.hidden = true;
      this.stopBigFishTimer();
      return;
    }
    box.hidden = false;
    this.renderBigFish();
    if (!this.bigFishTimer && this.bigFishAt > Date.now() + this.bigFishOffset) this.bigFishTimer = setInterval(() => this.renderBigFish(), 1000);
  }

  private renderBigFish(): void {
    const left = Math.max(0, Math.ceil((this.bigFishAt - (Date.now() + this.bigFishOffset)) / 1000));
    const text = left > 0 ? `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}` : 'đang lên!';
    if (text !== this.bigFishShown) {
      this.bigFishShown = text;
      $('bigfish-time').textContent = text;
    }
    if (left === 0) this.stopBigFishTimer();
  }

  private stopBigFishTimer(): void {
    if (this.bigFishTimer) clearInterval(this.bigFishTimer);
    this.bigFishTimer = null;
  }

  collective(c: CollectiveState | null): void {
    const box = $('collective');
    box.hidden = !c;
    if (!c) {
      this.collectiveSig = '';
      return;
    }
    const sig = `${c.status}|${c.name}|${c.progress}|${c.goal}|${c.participants}|${c.description}`;
    if (sig === this.collectiveSig) return;
    this.collectiveSig = sig;
    const done = c.status === 'completed';
    box.classList.toggle('done', done);
    $('collective-name').textContent = done ? `🪢 ${c.name} — THÀNH CÔNG!` : `🪢 ${c.name}`;
    $('collective-count').textContent = `${c.progress}/${c.goal} · ${c.participants} người`;
    $('collective-fill').style.transform = `scaleX(${Math.min(1, Math.max(0, c.progress / Math.max(1, c.goal)))})`;
    $('collective-desc').textContent = done ? 'Vòng mới sẽ bắt đầu ngay sau đây…' : c.description;
  }

  connectors(info: ConnectorInfo): void {
    const demo = info.demo.running;
    $('badge-demo').hidden = !demo;
    $('demo-ribbon').hidden = !demo;
    $('badge-live').hidden = info.tiktok.status !== 'connected';
    const wm = $('demo-watermark');
    if (demo && !wm.childElementCount) {
      // dựng một lần: các dòng chữ chìm so le, CSS xoay chéo cả khối (tĩnh, không vẽ lại)
      const line = Array(3).fill('DEMO · KHÔNG PHẢI NGƯỜI XEM THẬT').join('      ');
      wm.replaceChildren(...Array.from({ length: 10 }, () => el('div', '', line)));
    }
    wm.hidden = !demo;
    if (demo !== this.demo) {
      this.demo = demo;
      this.renderGifts();
    }
  }

  /** Biển "Bình luận để vào câu" to giữa mặt hồ. */
  joinCta(show: boolean): void {
    const e = $('join-cta');
    if (e.hidden === !show) return;
    e.hidden = !show;
  }

  private paused = false;
  private offline = false;

  running(r: boolean): void {
    this.paused = !r;
    this.renderStatus();
  }

  /** LIVE đang tắt (server báo streamOffline): dải riêng, thay cho dải tạm dừng. */
  streamOffline(off: boolean): void {
    this.offline = off;
    this.renderStatus();
  }

  /** Tối đa một dải trạng thái (ngoài DEMO); dải trạng thái mỏng nên dòng mẹo vẫn chạy (có câu tuân thủ về quà). */
  private renderStatus(): void {
    $('badge-offline').hidden = !this.offline;
    $('badge-paused').hidden = this.offline || !this.paused;
    $('hud-stack').classList.toggle('has-status', this.offline || this.paused);
  }

  connection(ok: boolean, msg = 'Mất kết nối máy chủ, đang thử lại…'): void {
    const e = $('conn-error');
    e.hidden = ok;
    e.textContent = msg;
  }
}
