import { Assets, Container, Graphics, GraphicsContext, Rectangle, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js';
import { ROSTER_MAX, type Mood, type RosterMember, type WorkEvent } from '@sep/shared';
import { Boss } from './boss';
import { lookFor, drawPerson, strikeSign, STAFF_W, Walker, staffCharacter, staffFrames, staffBodyH, STAFF_STAND_H } from './people';
import { block, hash, INK } from './pixel';

/*
 * Bố cục sân khấu 1080×1920 (dọc) — như một lớp học:
 *   0–300     HUD trên (tiêu đề, thanh trạng thái Sếp)
 *   300–790   "Bục giảng": Sếp đứng sau bàn, bảng KPI, cây phát tài, cầu dao, cửa thoát hiểm, WC, cửa sổ
 *   790–1400  4 phòng ban; số ghế tự giãn 32 → 48 → 72 → 112 theo số người (hiển thị tối đa 100)
 *   1400–1920 HUD dưới (sự kiện tập thể, hoạt động, bảng xếp hạng)
 */

export const SPOT = {
  floorY: 770,
  bossHome: 540,
  bossHeadY: 640,
  exitDoor: 86,
  wcDoor: 815,
  /** Ổ khoá treo trên cửa WC. */
  wcLockY: 640,
  /** Góc trái bục, nơi Sếp ra "sửa máy tính". */
  pcCorner: 250,
  deskTop: 705
} as const;
export const COFFEE_X = 660;
/** Cây phát tài (góc trái, cạnh lối ra) và hộp cầu dao trên tường. */
export const TREE = { x: 226, y: 774, leaves: 24 } as const;
export const BREAKER = { x: 358, y: 590 } as const;
/** Bảng KPI trên tường sau lưng Sếp. */
export const KPI_BOARD = { x: 428, y: 482, w: 224, h: 136 } as const;

export const DEPARTMENTS = [
  { name: 'KẾ TOÁN', shirt: 0x3584e4, carpet: 0xa9c1ed, border: 0x6f8fcb, plaque: 0x5b8fd6 },
  { name: 'NHÂN SỰ', shirt: 0xe66100, carpet: 0xfeb082, border: 0xe0845a, plaque: 0xe0703f },
  { name: 'KINH DOANH', shirt: 0x26a269, carpet: 0xacd394, border: 0x7fae78, plaque: 0x5fa06e },
  { name: 'IT', shirt: 0x9141ac, carpet: 0xc599cc, border: 0x9a6aa8, plaque: 0x925aa6 }
] as const;
const DEPT_W = 270;
/** Vùng đặt ghế (trục dọc). */
/** Kích thước đồ vật ảnh (toạ độ sân khấu, khớp ảnh tường office-wall.png). */
const BOSS_DESK_W = 236;
const BOSS_DESK_BOTTOM = 798;
/** Khung cửa WC trong ảnh tường. */
const WC_DOOR = { w: 118, h: 221, bottom: 737 } as const;
/** Hộp cầu dao trong ảnh tường (tâm) + chiều cao ảnh hộp cầu dao phủ lên. */
const BREAKER_IMG = { x: 354, y: 571 } as const;
const BREAKER_H = 89;
/** Bề ngang ảnh bàn nhân viên trống (đơn vị chỗ ngồi). */
const SEAT_DESK_IMG_W = 70;
/** Tường + bục: ảnh tường đặt từ WALL.top; sàn văn phòng bắt đầu ở WALL.floorTop. */
const WALL = { top: 270, floorTop: 873 } as const;
const PLAQUE_Y = 892;
const CARPET_TOP = 908;
const AREA_TOP = 936;
const AREA_BOTTOM = 1620;
/** Các mức bố cục: càng đông càng nhiều cột/hàng và ghế càng nhỏ. Mỗi mức × 4 phòng ban. */
const TIERS = [
  { cols: 2, rows: 4 }, // 32 chỗ
  { cols: 2, rows: 6 }, // 48 (ít cột, nhiều hàng → ghế to hơn)
  { cols: 3, rows: 6 }, // 72
  { cols: 3, rows: 9 } // 108 (hiển thị tối đa ROSTER_MAX = 100)
] as const;
/**
 * Chỗ ngồi tính theo "đơn vị" (root.scale = s quy ra px). Gốc toạ độ = mặt bàn, giữa bàn.
 * Người cao STAFF_STAND_H (100) đơn vị, chân ở y = SEAT_HIDE → phần trên mặt bàn = 100 − SEAT_HIDE.
 * Mặt trước bàn từ y = 0 đến SEAT_DESK_H (che phần thân dưới, gắn bảng tên + thẻ).
 */
const SEAT_HIDE = 38;
const SEAT_ABOVE = STAFF_STAND_H - SEAT_HIDE; // 62: đầu → mặt bàn
const SEAT_DESK_H = 22;
/** Bề ngang tối thiểu cho 1 người (đơn vị) — cột hẹp thì người được phép chạm nhau một chút. */
const SEAT_MIN_W = 56;
const MAX_EMOTES = 12;

const label = (text: string, style: TextStyleOptions = {}) =>
  new Text({ text, style: { fontFamily: 'Segoe UI, Arial', fontSize: 26, fontWeight: '900', fill: 0xffffff, ...style } });

// Ghế và bàn giống hệt nhau → dùng chung 1 GraphicsContext cho mọi chỗ (nhẹ hơn nhiều so với vẽ riêng).
// Đơn vị chỗ ngồi (xem SEAT_HIDE): lưng ghế nhô trên mặt bàn; bàn = mép mặt bàn + mặt trước.
const chairCtx = new GraphicsContext();
block(chairCtx, -22, -40, 44, 42, 0x3d3846, INK, 2);
const deskCtx = new GraphicsContext();
block(deskCtx, -34, -5, 68, 7, 0xb07a4a, INK, 2);
block(deskCtx, -33, 1, 66, SEAT_DESK_H - 1, 0x8a5a3b, INK, 2);

/** Thẻ nhân viên: đã follow kênh → chính thức; chưa → thực tập sinh (TTS). */
export const TAG = {
  official: { text: 'CHÍNH THỨC', color: 0xe5a50a },
  intern: { text: 'TTS', color: 0x77767b }
} as const;

// ---------------------------------------------------------------------------
// Chỗ ngồi
// ---------------------------------------------------------------------------
export interface Seat {
  index: number;
  dept: number;
  x: number;
  y: number;
  /** Tỉ lệ thu nhỏ của chỗ ngồi theo mức bố cục. */
  s: number;
  root: Container;
  person: Container;
  body: Graphics;
  sign: Container;
  tagBg: Graphics;
  tag: Text;
  plateBg: Graphics;
  plate: Text;
  member: RosterMember | null;
  cheerUntil: number;
  /** Đang làm "công việc" (gõ phím nhanh). */
  busyUntil: number;
  /** Ghế (sau lưng người, chỉ hiện khi trống chỗ) + bàn vẽ (luôn hiện, che thân dưới). */
  chair: Graphics;
  desk: Graphics;
  /** Sprite nhân viên (ẩn nếu chưa tải được sprite → dùng body vẽ pixel). */
  sprite: Sprite;
  /** Ảnh bàn làm việc trống (khi chỗ trống / người đi vắng / đứng dậy). */
  emptyDesk: Sprite;
  /** Khung sprite đã chọn cho người đang ngồi (dùng chung Texture, không tạo mới mỗi khung hình). */
  look: SeatLook | null;
}

interface SeatLook {
  idle: Texture;
  /** Ngồi ghế gõ laptop (khung đã có sẵn ghế + bàn + máy tính). */
  seated: Texture;
  cheer: Texture;
  walk: Texture[];
}

/**
 * Xếp người xem vào ghế theo phòng ban (phòng ban cố định theo ID người xem).
 * Danh sách người lấy từ server (roster, tối đa 100, ai tương tác gần nhất được giữ chỗ).
 * Đông người → bố cục chuyển sang mức nhiều ghế hơn, ghế nhỏ lại.
 */
export class Classroom {
  seats: Seat[] = [];
  private tier = -1;
  private byId = new Map<string, Seat>();
  private byName = new Map<string, Seat>();
  private t = 0;

  /** Bong bóng "công việc" đang hiện (tối đa MAX_EMOTES để nhẹ máy). */
  private emotes: { node: Container; until: number; born: number }[] = [];

  constructor(
    readonly layer: Container,
    readonly emoteLayer: Container = layer
  ) {
    this.build(0);
  }

  /** Ảnh bàn nhân viên (null → bàn + ghế vẽ tay). */
  private deskTex: Texture | null = null;

  setDeskTexture(t: Texture): void {
    this.deskTex = t;
    for (const s of this.seats) {
      s.emptyDesk.texture = t;
      s.emptyDesk.scale.set(SEAT_DESK_IMG_W / t.width);
      this.dress(s);
    }
  }

  /** Bàn/ghế hiển thị theo trạng thái chỗ ngồi. Chỉ đổi visible khi khác (không vẽ lại). */
  private dress(s: Seat): void {
    const here = !!s.member && s.person.visible && !s.sign.visible;
    // đang ngồi gõ máy: khung sprite đã có ghế + bàn + laptop
    const seated = here && !!s.look && s.cheerUntil <= performance.now();
    const img = !!this.deskTex;
    const showEmpty = img && !seated;
    const showDesk = !img && !seated;
    const showChair = !img && !here;
    if (s.emptyDesk.visible !== showEmpty) s.emptyDesk.visible = showEmpty;
    if (s.desk.visible !== showDesk) s.desk.visible = showDesk;
    if (s.chair.visible !== showChair) s.chair.visible = showChair;
  }

  get capacity(): number {
    return this.seats.length;
  }

  sync(roster: RosterMember[]): void {
    const members = roster.slice(0, ROSTER_MAX);
    let tier = TIERS.findIndex((t) => t.cols * t.rows * DEPARTMENTS.length >= members.length);
    if (tier < 0) tier = TIERS.length - 1;
    // Không co/giãn qua lại liên tục: chỉ về mức nhỏ hơn khi còn dư ít nhất 4 chỗ.
    if (tier < this.tier) {
      const lower = TIERS[tier]!;
      if (lower.cols * lower.rows * DEPARTMENTS.length - members.length < 4) tier = this.tier;
    }
    if (tier !== this.tier) this.build(tier);

    const keep = new Set(members.map((m) => m.platformId));
    for (const s of this.seats) if (s.member && !keep.has(s.member.platformId)) this.vacate(s);
    for (const m of members) {
      const s = this.byId.get(m.platformId);
      if (s) this.occupy(s, m);
      else {
        const dept = hash(m.platformId) % DEPARTMENTS.length;
        const free = this.seats.find((x) => !x.member && x.dept === dept) ?? this.seats.find((x) => !x.member);
        if (free) this.occupy(free, m);
      }
    }
  }

  seatOf(name: string | null | undefined): Seat | undefined {
    return name ? this.byName.get(name.trim()) : undefined;
  }

  occupied(): Seat[] {
    return this.seats.filter((s) => s.member);
  }

  /** Người xem vừa làm một công việc: bong bóng emoji + câu nói trên đầu, gõ phím lia lịa. */
  emote(e: WorkEvent, ms = 2600): void {
    const seat = this.byId.get(e.platformId) ?? this.seatOf(e.displayName);
    if (!seat) return;
    const now = performance.now();
    seat.busyUntil = now + ms;
    while (this.emotes.length >= MAX_EMOTES) this.emotes.shift()!.node.destroy({ children: true });
    const node = new Container();
    const t = new Text({
      text: `${e.emoji} ${[...e.text].slice(0, 24).join('')}`,
      style: { fontFamily: 'Segoe UI, Arial', fontSize: 20, fontWeight: '800', fill: INK }
    });
    t.anchor.set(0.5);
    const bg = new Graphics();
    const w = t.width + 20;
    bg.rect(-w / 2 - 3, -19, w + 6, 38).fill(INK).rect(-w / 2, -16, w, 32).fill(0xffffff).rect(-6, 16, 12, 8).fill(INK);
    node.addChild(bg, t);
    // giữ trong khung hình
    // ngay trên đỉnh đầu (đầu cao SEAT_ABOVE đơn vị trên mặt bàn = seat.y)
    node.position.set(Math.max(w / 2 + 6, Math.min(1080 - w / 2 - 6, seat.x)), seat.y - (SEAT_ABOVE + 4) * seat.s - 26);
    this.emoteLayer.addChild(node);
    this.emotes.push({ node, until: now + ms, born: now });
  }

  /** Người vừa ra tay: đứng bật dậy, bảng tên sáng lên. */
  cheer(name: string | null | undefined, ms = 2500): void {
    const s = this.seatOf(name);
    if (s) s.cheerUntil = performance.now() + ms;
  }

  tick(dtMs: number, freeze: boolean): void {
    this.t += dtMs;
    if (freeze) return;
    const nowE = performance.now();
    this.emotes = this.emotes.filter((e) => {
      if (e.until <= nowE) {
        e.node.destroy({ children: true });
        return false;
      }
      const age = nowE - e.born;
      e.node.alpha = Math.min(1, (e.until - nowE) / 400);
      e.node.pivot.y = Math.min(age, 600) * 0.03;
      return true;
    });
    const now = performance.now();
    for (const s of this.seats) {
      if (!s.member) continue;
      const cheering = s.cheerUntil > now;
      const striking = s.sign.visible;
      // gõ phím: nhích theo nhịp — chỉ đổi vị trí, không vẽ lại. Đình công: để hoạt ảnh tự dắt `person`.
      if (!striking) {
        s.person.y = cheering ? -Math.round(Math.abs(Math.sin(this.t * 0.02)) * 12) - 18 : Math.sin(this.t * 0.012 + s.index) > 0.7 ? -1 : 0;
        if (!cheering && s.busyUntil > now) s.person.y = Math.floor(this.t / 70) % 2 ? -3 : 0;
      }
      s.plateBg.tint = cheering ? 0xffd166 : 0xffffff;
      const lk = s.look;
      if (lk) {
        // Sprite sau bàn: đứng yên / đứng dậy reo hò / cầm biển đình công bước đi. Chỉ đổi Texture khi khác.
        const tex = striking ? lk.walk[Math.floor(this.t / 130) % lk.walk.length]! : cheering ? lk.cheer : lk.seated;
        if (s.sprite.texture !== tex) s.sprite.texture = tex;
      }
      this.dress(s);
    }
  }

  private build(tier: number): void {
    for (const s of this.seats) s.root.destroy({ children: true });
    this.seats = [];
    this.byId.clear();
    this.byName.clear();
    this.tier = tier;
    const { cols, rows } = TIERS[tier]!;
    const cellW = (DEPT_W - 20) / cols;
    const cellH = (AREA_BOTTOM - AREA_TOP) / rows;
    // Người (đầu → mặt bàn) + mặt trước bàn chiếm trọn chiều cao ô; ô hẹp thì giới hạn theo bề ngang.
    const unitH = SEAT_ABOVE + SEAT_DESK_H + 2;
    // trần 1.2: nhân viên không to hơn Sếp khi ít người
    const s = Math.min(cellH / unitH, cellW / SEAT_MIN_W, 1.2);
    // theo hàng từ trên xuống để hàng dưới (gần người xem) vẽ đè lên hàng trên
    for (let r = 0; r < rows; r++)
      for (let d = 0; d < DEPARTMENTS.length; d++)
        for (let c = 0; c < cols; c++) {
          const x = Math.round(d * DEPT_W + 10 + cellW * (c + 0.5));
          const y = Math.round(AREA_TOP + cellH * r + (cellH - unitH * s) / 2 + (SEAT_ABOVE + 2) * s);
          this.addSeat(d, x, y, s);
        }
  }

  private addSeat(dept: number, x: number, y: number, s: number): void {
    const root = new Container();
    root.position.set(x, y);
    root.scale.set(s);
    // Gốc toạ độ = mặt bàn. Người đứng sau bàn, chân ở y = SEAT_HIDE (bàn che phần thân dưới).
    const person = new Container();
    const body = new Graphics();
    // dự phòng vẽ pixel (ngồi, cao 85): thu lại cho đầu ở ~ −SEAT_ABOVE
    body.scale.set(0.75);
    body.y = 6;
    const sign = strikeSign();
    sign.scale.set(0.65);
    sign.position.set(STAFF_W / 2 - 6, -60);
    const sprite = new Sprite();
    sprite.anchor.set(0.5, 1);
    sprite.y = SEAT_HIDE;
    sprite.visible = false;
    person.addChild(body, sprite, sign);
    person.visible = false;
    const chair = new Graphics(chairCtx);
    const desk = new Graphics(deskCtx);
    const emptyDesk = new Sprite(this.deskTex ?? Texture.EMPTY);
    emptyDesk.anchor.set(0.5, 1);
    emptyDesk.y = SEAT_HIDE;
    if (this.deskTex) emptyDesk.scale.set(SEAT_DESK_IMG_W / this.deskTex.width);
    emptyDesk.visible = false;

    // Bảng tên + thẻ nằm trên mặt trước bàn (dưới người) — không che mặt.
    const res = Math.max(1, Math.ceil(s));
    const plateBg = new Graphics().rect(-27, 3, 54, 10).fill(0xffffff);
    plateBg.tint = 0xd8c7a8;
    const plate = new Text({ text: '', resolution: res, style: { fontFamily: 'Segoe UI, Arial', fontSize: 8, fontWeight: '800', fill: INK } });
    plate.anchor.set(0.5);
    plate.position.set(0, 8);
    const tagBg = new Graphics();
    const tag = new Text({ text: '', resolution: res, style: { fontFamily: 'Segoe UI, Arial', fontSize: 5.5, fontWeight: '900', fill: 0xffffff } });
    tag.anchor.set(0.5);
    tag.position.set(0, 17.5);
    tagBg.visible = tag.visible = false;

    root.addChild(chair, person, desk, emptyDesk, plateBg, plate, tagBg, tag);
    this.layer.addChild(root);
    const seat: Seat = {
      index: this.seats.length,
      dept,
      x,
      y,
      s,
      root,
      person,
      body,
      sign,
      tagBg,
      tag,
      plateBg,
      plate,
      member: null,
      cheerUntil: 0,
      busyUntil: 0,
      chair,
      desk,
      sprite,
      emptyDesk,
      look: null
    };
    this.seats.push(seat);
    this.dress(seat);
  }

  private occupy(seat: Seat, m: RosterMember): void {
    const prev = seat.member;
    seat.member = m;
    this.byId.set(m.platformId, seat);
    if (prev && prev.displayName !== m.displayName && this.byName.get(prev.displayName.trim()) === seat) this.byName.delete(prev.displayName.trim());
    this.byName.set(m.displayName.trim(), seat);
    if (prev && prev.platformId === m.platformId && prev.follower === m.follower && prev.displayName === m.displayName) return;

    const look = { ...lookFor(m.platformId, DEPARTMENTS[seat.dept]!.shirt), tie: m.follower };
    const ch = staffCharacter(look);
    if (ch) {
      // Sprite đứng yên sau bàn (bàn che thân dưới). Trạng thái (TTS / chính thức) xem ở thẻ trên bàn.
      seat.body.clear();
      seat.look = {
        idle: staffFrames(ch, 'idle')[0]!,
        seated: staffFrames(ch, 'seated')[0] ?? staffFrames(ch, 'idle')[0]!,
        cheer: staffFrames(ch, 'cheer')[0]!,
        walk: staffFrames(ch, 'walk')
      };
      seat.sprite.texture = seat.look.seated;
      seat.sprite.scale.set(STAFF_STAND_H / staffBodyH(ch));
      seat.sprite.visible = true;
    } else {
      // Dự phòng vẽ pixel: nhân viên chính thức (đã follow) đeo cà vạt; thực tập sinh thì không.
      seat.look = null;
      seat.sprite.visible = false;
      drawPerson(seat.body.clear(), look);
    }
    seat.person.visible = true;
    this.dress(seat);
    seat.plate.text = [...m.displayName].slice(0, 11).join('');
    seat.plateBg.tint = 0xffffff;
    const tag = m.follower ? TAG.official : TAG.intern;
    seat.tag.text = tag.text;
    // Chỗ nhỏ thì chữ thẻ không đọc được — chỉ giữ dải màu thẻ (rộng bằng bảng tên).
    seat.tag.visible = seat.s >= 1.5;
    const w = seat.tag.visible ? Math.max(seat.tag.width + 6, 20) : 54;
    seat.tagBg.clear().rect(-w / 2, 14.5, w, 6).fill(tag.color);
    seat.tagBg.visible = true;
  }

  private vacate(seat: Seat): void {
    if (seat.member) {
      const name = seat.member.displayName.trim();
      this.byId.delete(seat.member.platformId);
      if (this.byName.get(name) === seat) this.byName.delete(name);
    }
    seat.member = null;
    seat.look = null;
    seat.person.visible = false;
    this.dress(seat);
    seat.plate.text = '';
    seat.plateBg.tint = 0xd8c7a8;
    seat.tag.visible = seat.tagBg.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Bãi đỗ xe (cảnh cắt khi "Xịt lốp")
// ---------------------------------------------------------------------------
export interface Car {
  root: Container;
  rearWheel: Container;
  frontWheel: Container;
  puff: Graphics;
  /** Thay xe vẽ tay bằng ảnh xe thật. */
  useSprite(tex: Texture): void;
}

export interface Parking {
  root: Container;
  car: Car;
  walker: Walker;
  boss: Boss;
  fx: Container;
  /** Vị trí cửa toà nhà nơi Sếp chạy ra. */
  doorX: number;
  doorY: number;
}

export interface SceneRefs {
  root: Container;
  office: Container;
  boss: Boss;
  /** Bàn Sếp vẽ sẵn — ẩn đi khi dùng ảnh Sếp có kèm bàn. */
  bossDesk: Container;
  fx: Container;
  coffee: { cup: Container };
  wcDoor: Container;
  wcLock: Container;
  /** Cây phát tài: setLeaves(n) vẽ lại số lá còn lại (0..TREE.leaves). */
  tree: {
    root: Container;
    setLeaves(n: number): void;
    /** Cụm lá cắt từ ảnh cây (rỗng tới khi tải xong) — dùng làm lá bay khi bị vặt. */
    leafTex: Texture[];
    /** Đống lá rụng (null tới khi tải xong). */
    pileTex: Texture | null;
  };
  /** Hình vẽ bậy trên bảng KPI; reveal(0..1) hiện dần từ trái sang phải. */
  doodle: { root: Container; reveal(k: number): void };
  /** Cầu dao: lever.scale.y = -1 là đã ngắt; darkness phủ tối văn phòng. */
  breaker: { lever: Container; darkness: Graphics; setOff(off: boolean): void };
  classroom: Classroom;
  /** Tạo nhân vật của người xem đi lại trong văn phòng (mỗi hành động một nhân vật riêng). */
  spawnWalker(): Walker;
  removeWalker(w: Walker): void;
  parking: Parking;
  /** Màn đen chuyển cảnh + băng rôn tên cảnh. */
  fade: Graphics;
  banner: Container;
  bannerText: Text;
  setMood(m: Mood): void;
  tick(dtMs: number): void;
}

/** Dựng toàn bộ cảnh. Phần tĩnh được gộp thành texture (cacheAsTexture) để mỗi khung hình chỉ vẽ vài hình. */
export function buildOffice(): SceneRefs {
  const root = new Container();
  const office = new Container();
  root.addChild(office);

  // ----- Nền tĩnh (gộp 1 texture): tường + bục (ảnh hoặc vẽ tay), sàn gỗ, thảm + biển phòng ban -----
  const bg = new Container();
  const wallG = new Graphics();
  drawWall(wallG);
  const floorG = new Graphics();
  drawFloor(floorG);
  bg.addChild(wallG, floorG);

  const kpiText = label('KPI QUÝ 4 — DEADLINE: HÔM QUA', { fontSize: 15, fill: 0xe01b24 });
  kpiText.anchor.set(0.5, 0);
  kpiText.position.set(KPI_BOARD.x + KPI_BOARD.w / 2, KPI_BOARD.y + 2);
  bg.addChild(kpiText);
  DEPARTMENTS.forEach((d, i) => {
    const t = label(d.name, { fontSize: 22, stroke: { color: INK, width: 4 } });
    t.anchor.set(0.5);
    t.position.set(i * DEPT_W + DEPT_W / 2, PLAQUE_Y + 17);
    bg.addChild(t);
  });
  office.addChild(bg);

  // ----- WC: cửa (vẽ tay → ảnh) + trạng thái bị khoá -----
  const wcDoor = new Container();
  const wcG = new Graphics();
  block(wcG, -50, -200, 100, 200, 0x62a0ea, INK, 5);
  wcG.rect(30, -104, 10, 10).fill(0xdeddda);
  const wcText = label('WC', { fontSize: 36 });
  wcText.anchor.set(0.5);
  wcText.position.set(0, -160);
  wcDoor.addChild(wcG, wcText);
  wcDoor.position.set(SPOT.wcDoor, SPOT.floorY);
  office.addChild(wcDoor);

  const wcLock = new Container();
  const lockG = new Graphics();
  lockG.rect(-16, -34, 32, 8).fill(0x8f5b00).rect(-16, -34, 8, 22).fill(0x8f5b00).rect(8, -34, 8, 22).fill(0x8f5b00);
  block(lockG, -26, -14, 52, 40, 0xf5c211, INK, 4);
  lockG.position.set(0, SPOT.wcLockY - SPOT.floorY);
  wcLock.addChild(lockG);
  wcLock.position.set(SPOT.wcDoor, SPOT.floorY);
  wcLock.visible = false;
  office.addChild(wcLock);

  // ----- Cây phát tài (lá + bao lì xì vẽ lại khi bị vặt) -----
  const tree = buildLuckyTree();
  office.addChild(tree.root);

  // ----- Hình vẽ bậy trên bảng KPI (ẩn; hiện dần bằng mask) -----
  const doodle = buildDoodle();
  office.addChild(doodle.root);

  // ----- Cầu dao: cần gạt vẽ tay, có ảnh thì dùng ảnh hộp cầu dao bật / tắt -----
  const lever = new Container();
  const leverG = new Graphics();
  block(leverG, -8, -26, 16, 26, 0xe01b24, INK, 3);
  const breakerUp = new Sprite();
  const breakerDown = new Sprite();
  for (const sp of [breakerUp, breakerDown]) {
    sp.anchor.set(0.5);
    sp.visible = false;
  }
  lever.addChild(leverG, breakerUp, breakerDown);
  lever.position.set(BREAKER.x, BREAKER.y);
  office.addChild(lever);
  let breakerSprites = false;
  let breakerOff = false;
  const showBreaker = () => {
    leverG.visible = !breakerSprites;
    leverG.scale.y = breakerOff ? -1 : 1;
    breakerUp.visible = breakerSprites && !breakerOff;
    breakerDown.visible = breakerSprites && breakerOff;
  };

  // ----- Sếp + bàn Sếp -----
  const boss = new Boss();
  boss.position.set(SPOT.bossHome, SPOT.floorY);
  office.addChild(boss);

  const bossDesk = new Container();
  const dg = new Graphics();
  block(dg, 385, 640, 82, 56, 0x3584e4, INK, 6);
  dg.rect(418, 702, 16, 6).fill(INK);
  block(dg, 370, SPOT.deskTop, 340, 14, 0xa0704a, INK, 4);
  block(dg, 382, SPOT.deskTop + 18, 316, 58, 0x7a4e2f, INK, 4);
  block(dg, 482, SPOT.deskTop + 30, 116, 28, 0xf5c211, INK, 3);
  const deskImg = new Sprite();
  deskImg.anchor.set(0.5, 1);
  deskImg.visible = false;
  const plate = label('GIÁM ĐỐC', { fontSize: 18, fill: 0x3d2a00 });
  plate.anchor.set(0.5);
  plate.position.set(540, SPOT.deskTop + 44);
  bossDesk.addChild(dg, deskImg, plate);
  office.addChild(bossDesk);

  // ----- Cốc cà phê -----
  const cup = new Container();
  const cupG = new Graphics();
  block(cupG, -16, -38, 32, 38, 0xffffff, INK, 3);
  cupG.rect(16, -30, 10, 4).fill(INK).rect(22, -30, 4, 16).fill(INK).rect(16, -18, 10, 4).fill(INK);
  cupG.rect(-16, -38, 32, 8).fill(0x6b3e1f);
  cup.addChild(cupG);
  cup.position.set(COFFEE_X, SPOT.deskTop);
  office.addChild(cup);

  // Ảnh tường + đồ vật vẽ sẵn (tải xong thì thay hình vẽ tay; lỗi thì giữ hình vẽ tay).
  let wcSprites = false;
  loadOfficeWall(bg, wallG, () => {
    // ảnh tường đã có cửa WC → cửa vẽ tay chỉ cần khi chưa có ảnh cửa
    if (!wcSprites) wcDoor.visible = false;
  });
  loadProps(['boss-desk', 'wc-door', 'wc-door-locked', 'breaker-up', 'breaker-down'], (t) => {
    const desk = t['boss-desk'];
    if (desk) {
      // bàn gỗ lớn: đáy ở mép bục, mặt bàn ~ 36% chiều cao ảnh
      deskImg.texture = desk;
      deskImg.scale.set(BOSS_DESK_W / desk.width);
      deskImg.position.set(SPOT.bossHome, BOSS_DESK_BOTTOM);
      deskImg.visible = true;
      dg.visible = false;
      plate.position.set(SPOT.bossHome, BOSS_DESK_BOTTOM - deskImg.height * 0.3);
      plate.style.fontSize = 15;
      plate.style.fill = 0xffe8a3;
      cup.position.set(SPOT.bossHome + BOSS_DESK_W * 0.18, BOSS_DESK_BOTTOM - deskImg.height * 0.64);
      bossDesk.updateCacheTexture();
    }
    const door = t['wc-door'];
    const locked = t['wc-door-locked'];
    if (door && locked) {
      // phủ đúng khung cửa WC trong ảnh tường (rộng × cao), giữ cửa riêng để còn rung khi Sếp giật cửa
      const sx = WC_DOOR.w / door.width;
      const sy = WC_DOOR.h / door.height;
      const a = new Sprite({ texture: door, anchor: { x: 0.5, y: 1 } });
      a.scale.set(sx, sy);
      wcDoor.removeChildren();
      wcDoor.addChild(a);
      wcDoor.position.set(SPOT.wcDoor, WC_DOOR.bottom);
      wcDoor.visible = true;
      const b = new Sprite({ texture: locked, anchor: { x: 0.5, y: 1 } });
      b.scale.set(sx, sy);
      wcLock.removeChildren();
      wcLock.addChild(b);
      wcLock.position.set(SPOT.wcDoor, WC_DOOR.bottom);
      wcSprites = true;
    }
    const up = t['breaker-up'];
    const down = t['breaker-down'];
    if (up && down) {
      const k = BREAKER_H / up.height;
      breakerUp.texture = up;
      breakerDown.texture = down;
      breakerUp.scale.set(k);
      breakerDown.scale.set(k);
      lever.position.set(BREAKER_IMG.x, BREAKER_IMG.y);
      breakerSprites = true;
      showBreaker();
    }
  });

  // ----- Nhân viên -----
  const seatsLayer = new Container();
  const emotesLayer = new Container();
  const classroom = new Classroom(seatsLayer, emotesLayer);
  loadProps(['staff-desk'], (t) => {
    if (t['staff-desk']) classroom.setDeskTexture(t['staff-desk']);
  });
  office.addChild(seatsLayer);

  // nhân vật người xem đang đi làm "nhiệm vụ" (trên lớp ghế)
  const walkersLayer = new Container();
  const walkers = new Set<Walker>();
  office.addChild(walkersLayer, emotesLayer);

  // Mất điện: phủ tối cả văn phòng (dưới lớp chữ hiệu ứng để lời thoại vẫn đọc được).
  const darkness = new Graphics().rect(0, 0, 1080, 1920).fill(0x05060a);
  darkness.alpha = 0;
  darkness.visible = false;
  office.addChild(darkness);

  const fx = new Container();
  office.addChild(fx);

  // phần tĩnh → 1 texture
  bg.cacheAsTexture(true);
  bossDesk.cacheAsTexture(true);

  // ----- Cảnh bãi đỗ xe (ẩn: không tốn khung hình khi không dùng) -----
  const parking = buildParking();
  root.addChild(parking.root);

  // ----- Chuyển cảnh -----
  const fade = new Graphics().rect(0, 0, 1080, 1920).fill(0x000000);
  fade.alpha = 0;
  fade.visible = false;
  const banner = new Container();
  const bannerG = new Graphics();
  block(bannerG, -330, -44, 660, 88, 0xffd166, INK, 6);
  const bannerText = label('', { fontSize: 44, fill: INK });
  bannerText.anchor.set(0.5);
  banner.addChild(bannerG, bannerText);
  banner.position.set(540, 360);
  banner.visible = false;
  root.addChild(fade, banner);

  return {
    root,
    office,
    boss,
    bossDesk,
    fx,
    coffee: { cup },
    wcDoor,
    wcLock,
    tree,
    doodle,
    breaker: {
      lever,
      darkness,
      setOff(off) {
        if (off === breakerOff) return;
        breakerOff = off;
        showBreaker();
      }
    },
    classroom,
    spawnWalker() {
      const w = new Walker(1.4);
      w.visible = false;
      walkersLayer.addChild(w);
      walkers.add(w);
      return w;
    },
    removeWalker(w) {
      walkers.delete(w);
      w.destroy({ children: true });
    },
    parking,
    fade,
    banner,
    bannerText,
    setMood(m) {
      boss.setMood(m);
      parking.boss.setMood(m);
    },
    tick(dtMs) {
      if (office.visible) boss.tick(dtMs);
      classroom.tick(dtMs, !office.visible);
      if (office.visible) for (const w of walkers) if (w.visible) w.tick(dtMs);
      if (parking.root.visible) {
        parking.boss.tick(dtMs);
        parking.walker.tick(dtMs);
      }
    }
  };
}

/** Tải nhiều ảnh đồ vật (sprites/props/<id>.png) cùng lúc; ảnh nào lỗi thì bỏ qua (giữ hình vẽ tay). */
function loadProps(ids: string[], done: (t: Partial<Record<string, Texture>>) => void): void {
  const base = `${import.meta.env.BASE_URL}sprites/props/`;
  Promise.all(
    ids.map((id) =>
      Assets.load<Texture>(`${base}${id}.png`)
        .then((t) => {
          t.source.scaleMode = 'nearest';
          return [id, t] as const;
        })
        .catch(() => [id, undefined] as const)
    )
  ).then((list) => done(Object.fromEntries(list)));
}

/**
 * Ảnh tường văn phòng (public/sprites/bg/office-wall.png, ngang 16:9: tường + bục Sếp), đặt ở WALL.top, phóng theo bề ngang 1080.
 * Có ảnh thì ẩn tường vẽ tay + cửa WC vẽ tay (cửa đã có trong ảnh); sàn + thảm phòng ban luôn vẽ bằng code.
 */
function loadOfficeWall(bg: Container, drawnWall: Graphics, onLoaded: () => void): void {
  const url = `${import.meta.env.BASE_URL}sprites/bg/office-wall.png`;
  fetch(url, { method: 'HEAD' })
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/') ? Assets.load<Texture>(url) : null))
    .then((t) => {
      if (!t) return;
      t.source.scaleMode = 'nearest';
      const photo = new Sprite(t);
      photo.scale.set(1080 / t.width);
      photo.position.set(0, WALL.top);
      bg.addChildAt(photo, bg.getChildIndex(drawnWall) + 1);
      drawnWall.visible = false;
      onLoaded();
      bg.updateCacheTexture();
    })
    .catch(() => {
      /* giữ tường vẽ tay */
    });
}

/** Tường + bục vẽ tay (dùng khi chưa có ảnh tường). Vẽ một lần rồi cache thành texture. */
function drawWall(g: Graphics): void {
  g.rect(0, 0, 1080, WALL.floorTop).fill(0x23262f);
  // trần + phào chỉ
  g.rect(0, 286, 1080, 26).fill(0xf7f1e3).rect(0, 312, 1080, 6).fill(0xd6c49c).rect(0, 318, 1080, 3).fill(0x9c8a68);
  // tường: giấy dán sọc dọc
  g.rect(0, 321, 1080, 309).fill(0xf6e3c0);
  for (let x = 18; x < 1080; x += 40) g.rect(x, 321, 16, 309).fill(0xefd6ac);
  // ốp gỗ chân tường
  g.rect(0, 630, 1080, 8).fill(0xc98a5a);
  g.rect(0, 638, 1080, 100).fill(0xd99a68);
  for (let x = 8; x < 1080; x += 100) g.rect(x, 650, 84, 76).stroke({ color: 0xb87a4c, width: 3 });
  // đèn trần
  for (const x of [200, 540, 880]) {
    g.poly([x - 50, 322, x + 50, 322, x + 130, 520, x - 130, 520]).fill({ color: 0xfff3c4, alpha: 0.15 });
    g.rect(x - 40, 304, 80, 10).fill(0x5e5c64).rect(x - 36, 314, 72, 4).fill(0xfffbe0);
  }
  // bảng KPI (biểu đồ cột co theo kích thước bảng)
  const b = KPI_BOARD;
  block(g, b.x, b.y, b.w, b.h, 0xffffff, 0x9a9996, 6);
  const bars = [0.8, 0.62, 0.45, 0.3];
  bars.forEach((h, i) => g.rect(b.x + 30 + i * 42, b.y + b.h - 20 - h * (b.h - 40), 26, h * (b.h - 40)).fill(0x3584e4));
  g.rect(b.x + 20, b.y + 14, 3, b.h - 32).fill(0x3d3846).rect(b.x + 20, b.y + b.h - 20, b.w - 40, 3).fill(0x3d3846);
  // đồng hồ
  block(g, 200, 412, 60, 60, 0xffffff, 0x5e5c64, 5);
  g.rect(228, 422, 4, 22).fill(INK).rect(228, 440, 16, 4).fill(INK);
  // cửa thoát hiểm + biển xanh
  block(g, 32, 518, 104, 218, 0xc8763c, 0x8a4f26, 5);
  g.rect(112, 640, 8, 14).fill(0xf5c211);
  block(g, 52, 484, 64, 18, 0x2ec27e, 0x1d6b3f, 3);
  // hộp cầu dao (cần gạt vẽ riêng để bật/tắt)
  block(g, BREAKER.x - 28, BREAKER.y - 50, 56, 74, 0xc0bfbc, 0x77767b, 4);
  // cửa sổ (góc phải)
  block(g, 912, 480, 140, 128, 0xa8dcf5, 0xf6f5f4, 6);
  g.rect(912, 480, 140, 26).fill(0xdeddda).rect(980, 480, 6, 128).fill(0xf6f5f4);
  // bục (sàn gỗ sẫm, ván so le) + mép trước
  g.rect(0, 736, 1080, 82).fill(0x8a4f3a);
  for (let row = 0; row < 3; row++) {
    const y = 736 + row * 27;
    g.rect(0, y, 1080, 2).fill(0x6e3c2c);
    for (let x = (row % 2) * 80; x < 1080; x += 160) g.rect(x, y, 2, 27).fill(0x6e3c2c);
  }
  g.rect(0, 818, 1080, WALL.floorTop - 818).fill(0x5a3328);
}

/** Sàn văn phòng + thảm/biển phòng ban + góc cuối phòng (luôn vẽ bằng code, màu theo ảnh mẫu). */
function drawFloor(g: Graphics): void {
  const top = WALL.floorTop;
  g.rect(0, top, 1080, 1920 - top).fill(0xfecc8d);
  for (let y = top + 10, row = 0; y < 1920; y += 36, row++) {
    const off = (row * 53) % 200;
    for (let x = -off; x < 1080; x += 200) {
      const v = hash(`p${row}:${x}`) % 4;
      if (v === 0) g.rect(x + 2, y + 2, 198, 34).fill(0xf6c283);
      else if (v === 1) g.rect(x + 2, y + 2, 198, 34).fill(0xffd59c);
      g.rect(x, y, 2, 36).fill(0xe2ab6c);
    }
    g.rect(0, y, 1080, 2).fill(0xe2ab6c);
  }
  g.rect(0, top, 1080, 12).fill({ color: 0x000000, alpha: 0.18 });

  DEPARTMENTS.forEach((d, i) => {
    const x0 = i * DEPT_W;
    const h = AREA_BOTTOM - CARPET_TOP;
    g.rect(x0 + 15, CARPET_TOP + 6, DEPT_W - 22, h).fill({ color: 0x000000, alpha: 0.12 });
    block(g, x0 + 12, CARPET_TOP, DEPT_W - 24, h, d.carpet, d.border, 4);
    g.rect(x0 + 24, CARPET_TOP + 12, DEPT_W - 48, h - 24).stroke({ color: d.border, width: 2, alpha: 0.5 });
    g.rect(x0 + 39, PLAQUE_Y + 4, DEPT_W - 70, 34).fill({ color: 0x000000, alpha: 0.2 });
    block(g, x0 + 35, PLAQUE_Y, DEPT_W - 70, 34, d.plaque, INK, 3);
    g.rect(x0 + 35, PLAQUE_Y, DEPT_W - 70, 4).fill({ color: 0xffffff, alpha: 0.3 });
  });

  // cuối phòng: cây nước (trái) + máy in (phải)
  const by = AREA_BOTTOM + 30;
  block(g, 60, by + 40, 56, 90, 0xdeddda, INK, 4);
  block(g, 66, by + 4, 44, 40, 0x99c1f1, INK, 4);
  g.rect(70, by + 70, 10, 8).fill(0x3584e4).rect(96, by + 70, 10, 8).fill(0xe01b24);
  block(g, 944, by + 60, 96, 70, 0x9a9996, INK, 4);
  block(g, 956, by + 44, 72, 18, 0xffffff, INK, 3);
  g.rect(956, by + 84, 56, 6).fill(INK).rect(1020, by + 74, 10, 8).fill(0x2ec27e);
}

/** Cây phát tài: chậu + thân vẽ một lần; lá và bao lì xì vẽ lại khi số lá thay đổi (hiếm). */
function buildLuckyTree(): SceneRefs['tree'] {
  const root = new Container();
  root.position.set(TREE.x, TREE.y);
  const base = new Graphics();
  base.rect(-6, -170, 12, 130).fill(0x6f4e37).rect(-30, -120, 30, 8).fill(0x6f4e37).rect(0, -150, 34, 8).fill(0x6f4e37);
  block(base, -34, -46, 68, 46, 0xc01c28, INK, 3);
  base.rect(-24, -32, 48, 6).fill(0xf5c211);
  const leaves = new Graphics();
  root.addChild(base, leaves);
  const spots: [number, number][] = [];
  for (let i = 0; i < TREE.leaves; i++) {
    const a = (i / TREE.leaves) * Math.PI * 2;
    const r = 8 + (i % 4) * 16;
    spots.push([Math.round(Math.cos(a * 3) * r * 1.25), Math.round(-195 + Math.sin(a * 3) * r * 0.9)]);
  }
  let shown = -1;
  const setLeaves = (n: number) => {
    n = Math.max(0, Math.min(TREE.leaves, Math.round(n)));
    if (n === shown) return;
    shown = n;
    leaves.clear();
    spots.slice(0, n).forEach(([x, y], i) => {
      if (i % 4 === 3) {
        // bao lì xì
        leaves.rect(x - 8, y - 10, 16, 22).fill(INK).rect(x - 6, y - 8, 12, 18).fill(0xe01b24).rect(x - 3, y - 2, 6, 6).fill(0xf5c211);
      } else {
        leaves.rect(x - 18, y - 11, 36, 22).fill(INK).rect(x - 16, y - 9, 32, 18).fill(i % 2 ? 0x26a269 : 0x2ec27e);
      }
    });
  };
  setLeaves(TREE.leaves);

  // Ảnh bonsai thật (5 khung: nguyên vẹn → trụi lá). Tải xong thì thay cây vẽ tay.
  let frames: Texture[] | null = null;
  const img = new Sprite();
  img.anchor.set(0.5, 1);
  img.visible = false;
  root.addChild(img);
  const base_ = `${import.meta.env.BASE_URL}sprites/props/`;
  fetch(`${base_}tree.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ frameW: number; frameH: number; frames: number }>) : Promise.reject()))
    .then(async (m) => {
      const strip = await Assets.load<Texture>(`${base_}tree.png`);
      strip.source.scaleMode = 'nearest';
      frames = Array.from({ length: m.frames }, (_, i) => new Texture({ source: strip.source, frame: new Rectangle(i * m.frameW, 0, m.frameW, m.frameH) }));
      img.scale.set(TREE_SPRITE_H / m.frameH);
      img.texture = frames[0]!;
      img.visible = true;
      base.visible = false;
      leaves.visible = false;
      shown = -1;
      setLeaves(TREE.leaves);
    })
    .catch(() => {
      /* giữ cây vẽ tay */
    });

  const leafTex: Texture[] = [];
  const out: SceneRefs['tree'] = {
    root,
    leafTex,
    pileTex: null,
    setLeaves(n) {
      setLeaves(n);
      if (!frames) return;
      // còn bao nhiêu phần lá → khung tương ứng (0 = nguyên vẹn, cuối = trụi)
      const k = Math.max(0, Math.min(1, n / TREE.leaves));
      const idx = Math.min(frames.length - 1, Math.floor((1 - k) * frames.length * 1.05));
      if (img.texture !== frames[idx]) img.texture = frames[idx]!;
    }
  };
  for (const id of ['leaf-clump', 'leaf-clump2'])
    Assets.load<Texture>(`${base_}${id}.png`)
      .then((t) => {
        t.source.scaleMode = 'nearest';
        leafTex.push(t);
      })
      .catch(() => {});
  Assets.load<Texture>(`${base_}leaf-pile.png`)
    .then((t) => {
      t.source.scaleMode = 'nearest';
      out.pileTex = t;
    })
    .catch(() => {});
  return out;
}

/** Chiều cao cây bonsai trên sân khấu (px). */
const TREE_SPRITE_H = 230;

/** Tranh biếm hoạ Sếp hói trên bảng KPI; mask chạy từ trái qua phải như đang vẽ. */
function buildDoodle(): SceneRefs['doodle'] {
  const root = new Container();
  root.position.set(KPI_BOARD.x, KPI_BOARD.y);
  root.scale.set(KPI_BOARD.w / 420);
  const art = new Graphics();
  const M = 0x1c71d8;
  // đầu hói to + tóc 2 bên
  art.rect(40, 70, 120, 8).fill(M).rect(32, 78, 8, 90).fill(M).rect(160, 78, 8, 90).fill(M).rect(40, 168, 120, 8).fill(M);
  art.rect(22, 110, 10, 26).fill(M).rect(168, 110, 10, 26).fill(M);
  // mắt trợn + lông mày giận + miệng méo
  art.rect(62, 104, 26, 6).fill(M).rect(112, 104, 26, 6).fill(M);
  art.rect(70, 118, 10, 10).fill(M).rect(120, 118, 10, 10).fill(M);
  art.rect(76, 146, 48, 6).fill(M).rect(70, 140, 8, 8).fill(M).rect(122, 140, 8, 8).fill(M);
  // đường "bóng loáng" trên đầu
  art.rect(70, 86, 30, 4).fill(0xf5c211).rect(110, 86, 10, 4).fill(0xf5c211);
  const text = label('SẾP HÓI =))', { fontSize: 38, fill: M });
  text.position.set(196, 96);
  const arrow = new Graphics().rect(196, 150, 120, 6).fill(M).rect(196, 144, 18, 18).fill(M);
  root.addChild(art, text, arrow);
  const mask = new Graphics();
  root.addChild(mask);
  root.mask = mask;
  root.visible = false;
  return {
    root,
    reveal(k) {
      root.visible = k > 0;
      mask.clear();
      if (k > 0) mask.rect(0, 0, 420 * Math.min(1, k), 230).fill(0xffffff);
    }
  };
}

/**
 * Ảnh bãi xe phóng cho kín chiều cao [top, bottom] của khung 9:16 (cắt bớt hai bên, lệch offX).
 * door / slot là toạ độ TRÊN ẢNH (sprites/bg/parking.png): cửa toà nhà và ô đỗ trống cho xe Sếp.
 */
const PARK = { top: 240, bottom: 1700, offX: -80, door: [180, 450], slot: [478, 592] } as const;

function buildParking(): Parking {
  const root = new Container();
  root.visible = false;
  const stat = new Container();
  const g = new Graphics();
  // trời + mây
  g.rect(0, 0, 1080, 560).fill(0x8ecae6);
  for (const [x, y] of [
    [120, 330],
    [760, 380],
    [430, 470]
  ] as const)
    g.rect(x, y, 140, 30).fill(0xffffff).rect(x + 30, y - 24, 80, 24).fill(0xffffff);
  // toà nhà công ty
  block(g, 150, 320, 780, 440, 0xdedcd6, INK, 6);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++) {
      if (r === 2 && (c === 3 || c === 4)) continue;
      block(g, 185 + c * 92, 420 + r * 100, 62, 64, 0x5aa9e6, 0x3d405b, 3);
    }
  block(g, 470, 620, 140, 140, 0x9fd3f0, 0x3d405b, 5);
  g.rect(538, 620, 4, 140).fill(0x3d405b);
  block(g, 330, 338, 420, 50, 0x3d405b, INK, 4);
  // bốt bảo vệ + cây
  block(g, 36, 640, 90, 120, 0xf6f5f4, INK, 4);
  g.rect(46, 660, 70, 36).fill(0x5aa9e6);
  for (const x of [990, 70]) g.rect(x - 8, 560, 16, 200).fill(0x6f4e37).rect(x - 50, 470, 100, 100).fill(0x26a269);
  // vỉa hè + mặt đường
  g.rect(0, 760, 1080, 50).fill(0xb8b4ac);
  for (let x = 0; x < 1080; x += 60) g.rect(x, 760, 2, 50).fill(0x9a9690);
  g.rect(0, 810, 1080, 1110).fill(0x4a4a52);
  for (let x = 90; x < 1080; x += 180) g.rect(x, 1000, 8, 240).fill(0xf6f5f4);
  g.rect(0, 1240, 1080, 8).fill(0xf6f5f4);
  // dãy xe máy
  for (let i = 0; i < 6; i++) {
    const x = 70 + i * 170;
    const col = [0xe01b24, 0x3584e4, 0x241f31, 0xf5c211, 0x26a269, 0xc0bfbc][i]!;
    g.rect(x - 34, 870, 30, 30).fill(INK).rect(x + 30, 870, 30, 30).fill(INK);
    block(g, x - 30, 838, 86, 26, col, INK, 3);
    g.rect(x + 40, 812, 8, 30).fill(INK).rect(x - 26, 826, 40, 12).fill(INK);
  }
  // xe hàng xóm
  block(g, 40, 1330, 250, 80, 0x3584e4, INK, 4);
  block(g, 80, 1290, 160, 44, 0x9fd3f0, INK, 4);
  block(g, 800, 1330, 250, 80, 0xf6f5f4, INK, 4);
  block(g, 840, 1290, 160, 44, 0x9fd3f0, INK, 4);
  stat.addChild(g);
  const sign = label('CÔNG TY TNHH SẾP ƠI', { fontSize: 30, fill: 0xffd166 });
  sign.anchor.set(0.5);
  sign.position.set(540, 363);
  const lot = label('BÃI ĐỖ XE — CHỖ CỦA SẾP', { fontSize: 22, fill: 0xf6f5f4 });
  lot.anchor.set(0.5);
  lot.position.set(540, 1268);
  stat.addChild(sign, lot);
  stat.cacheAsTexture(true);
  root.addChild(stat);

  // Ảnh ngoại cảnh thật (bãi đỗ xe pixel) — tải xong thì thay nền vẽ tay; lỗi thì giữ nền vẽ tay.
  const photo = new Container();
  photo.visible = false;
  root.addChild(photo);
  Assets.load<Texture>(`${import.meta.env.BASE_URL}sprites/bg/parking.png`)
    .then((tex) => {
      tex.source.scaleMode = 'nearest';
      const k = (PARK.bottom - PARK.top) / tex.height;
      const top = PARK.top;
      const at = ([x, y]: readonly [number, number]) => [Math.round(PARK.offX + x * k), Math.round(top + y * k)] as const;
      const sky = new Graphics().rect(0, 0, 1080, top + 2).fill(0x7fb6ef);
      const ground = new Graphics().rect(0, PARK.bottom - 2, 1080, 1920).fill(0x8f8a80);
      const img = new Sprite(tex);
      img.scale.set(k);
      img.position.set(PARK.offX, top);
      photo.addChild(sky, ground, img);
      photo.cacheAsTexture(true);
      photo.visible = true;
      stat.visible = false;
      car.root.position.set(...at(PARK.slot));
      Assets.load<Texture>(`${import.meta.env.BASE_URL}sprites/props/car.png`)
        .then((t) => {
          t.source.scaleMode = 'nearest';
          car.useSprite(t);
        })
        .catch(() => car.root.scale.set(0.8));
      [parking.doorX, parking.doorY] = at(PARK.door);
      boss.position.set(parking.doorX, parking.doorY);
    })
    .catch(() => {
      /* giữ nền vẽ tay */
    });

  const car = buildCar();
  car.root.position.set(560, 1190);
  root.addChild(car.root);

  const boss = new Boss();
  boss.position.set(540, 760);
  boss.visible = false;
  root.addChild(boss);

  const walker = new Walker(1.3);
  walker.visible = false;
  root.addChild(walker);

  const fx = new Container();
  root.addChild(fx);
  const parking: Parking = { root, car, walker, boss, fx, doorX: 540, doorY: 760 };
  return parking;
}

function buildCar(): Car {
  const root = new Container();
  const body = new Graphics();
  body.rect(-180, -8, 360, 14).fill({ color: 0x000000, alpha: 0.35 });
  block(body, -170, -96, 340, 70, 0xd62828, INK, 5);
  block(body, -100, -160, 196, 64, 0xc01c28, INK, 5);
  body.rect(-86, -150, 80, 46).fill(0xdff2fb).rect(6, -150, 78, 46).fill(0xdff2fb);
  body.rect(156, -82, 14, 18).fill(0xf5c211).rect(-170, -82, 14, 18).fill(0x8b0000);
  block(body, -40, -60, 80, 24, 0xffffff, INK, 3);
  const plate = label('SẾP-01', { fontSize: 16, fill: INK });
  plate.anchor.set(0.5);
  plate.position.set(0, -48);
  root.addChild(body, plate);
  const wheel = () => {
    const c = new Container();
    const w = new Graphics();
    w.rect(-30, -60, 60, 60).fill(INK);
    w.rect(-14, -44, 28, 28).fill(0xc0bfbc);
    c.addChild(w);
    return c;
  };
  const rearWheel = wheel();
  rearWheel.position.set(-105, 6);
  const frontWheel = wheel();
  frontWheel.position.set(105, 6);
  const puff = new Graphics();
  for (const [x, y, s] of [
    [-150, -40, 18],
    [-176, -60, 14],
    [-196, -30, 12],
    [-214, -56, 10]
  ] as const)
    puff.rect(x, y, s, s).fill({ color: 0xffffff, alpha: 0.95 });
  puff.alpha = 0;
  root.addChild(rearWheel, frontWheel, puff);
  return {
    root,
    rearWheel,
    frontWheel,
    puff,
    useSprite(tex) {
      // Ảnh xe (sprites/props/car.png) quay đầu sang trái → lật ngang để đuôi xe ở bên trái.
      const k = 0.64;
      const img = new Sprite(tex);
      img.anchor.set(0.5, 1);
      img.scale.set(-k, k);
      img.y = 6;
      // Bánh sau = cắt đúng vùng bánh trên ảnh, đè lên chỗ cũ để bóp bẹp được.
      const wx = CAR_WHEEL.x0 + CAR_WHEEL.w / 2;
      const wTex = new Texture({ source: tex.source, frame: new Rectangle(CAR_WHEEL.x0, CAR_WHEEL.y0, CAR_WHEEL.w, tex.height - CAR_WHEEL.y0) });
      const wSpr = new Sprite(wTex);
      wSpr.anchor.set(0.5, 1);
      wSpr.scale.set(-k, k);
      rearWheel.removeChildren().forEach((c) => c.destroy());
      rearWheel.addChild(wSpr);
      rearWheel.position.set(-(wx - tex.width / 2) * k, 6);
      body.visible = false;
      frontWheel.visible = false;
      root.addChildAt(img, 0);
      // biển số dán bên hông cho dễ nhận ra xe Sếp
      const tag = new Graphics();
      block(tag, -42, -14, 84, 28, 0xffffff, INK, 3);
      tag.position.set(10, -64);
      root.addChildAt(tag, root.getChildIndex(plate));
      plate.position.set(10, -64);
    }
  };
}

/** Vùng bánh sau trên ảnh car.png (toạ độ ảnh chưa lật). */
const CAR_WHEEL = { x0: 415, y0: 150, w: 104 } as const;
