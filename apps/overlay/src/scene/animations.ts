import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { RunningAction } from '@sep/shared';
import { hasClip, type BossClip, type BossPose } from './boss';
import { BREAKER, DEPARTMENTS, KPI_BOARD, SPOT, TREE, type SceneRefs, type Seat } from './office';
import { lookFor } from './people';
import { hash, INK } from './pixel';
import { clamp01, easeIn, easeInOut, easeOut, lerp, seg } from './util';

/**
 * Mỗi hoạt ảnh là một timeline xác định theo thời gian: update(ms) vẽ đúng trạng thái tại thời điểm ms.
 * Nhờ vậy overlay mở giữa chừng vẫn vẽ đúng vị trí; finish() luôn đưa cảnh về trạng thái gốc.
 * Server đảm bảo không có hai hoạt ảnh dùng chung lane chạy cùng lúc.
 */
export interface ActionAnim {
  update(elapsedMs: number): void;
  finish(): void;
}

export type AnimFactory = (s: SceneRefs, run: RunningAction) => ActionAnim;

const bubble = (text: string, color = 0xe01b24, size = 44) =>
  new Text({ text, style: { fontFamily: 'Segoe UI, Arial', fontSize: size, fontWeight: '900', fill: color, stroke: { color: 0xffffff, width: 8 } } });

/** Di chuyển Sếp giữa hai điểm, có bước đi. */
function walkBoss(s: SceneRefs, from: number, to: number, t: number): void {
  s.boss.x = lerp(from, to, easeInOut(t));
  s.boss.walking = t > 0 && t < 1;
  s.boss.scale.x = to < from ? -1 : 1;
}

function pose(s: SceneRefs, p: BossPose | BossClip | null): void {
  s.boss.setPose(p);
}

function resetBoss(s: SceneRefs): void {
  s.boss.position.set(SPOT.bossHome, SPOT.floorY);
  s.boss.alpha = 1;
  s.boss.walking = false;
  s.boss.running = false;
  s.boss.scale.x = 1;
  s.boss.leanAngle = 0;
  s.boss.shakeAmount = 0;
  s.boss.setExpression(null);
  s.boss.setPose(null);
  s.bossDesk.visible = true;
}

/** Ghế của người ra tay; không có thì một ghế bất kỳ đang có người. */
function actorSeat(s: SceneRefs, run: RunningAction): Seat | undefined {
  const own = s.classroom.seatOf(run.actor?.displayName);
  if (own) return own;
  const occ = s.classroom.occupied();
  return occ.length ? occ[hash(run.runId) % occ.length] : undefined;
}

// ---------------------------------------------------------------------------

/**
 * "Chuyến đi" của nhân vật người xem: rời ghế → đi tới đích → làm việc → quay về ghế.
 * Ghế để trống trong lúc nhân vật đi vắng. Người chưa có ghế thì đi vào từ mép dưới.
 */
function makeTrip(s: SceneRefs, run: RunningAction) {
  const name = run.actor?.displayName ?? 'Nhân viên ẩn danh';
  const seat = s.classroom.seatOf(name);
  const w = s.spawnWalker();
  const shirt = DEPARTMENTS[seat?.dept ?? hash(name) % DEPARTMENTS.length]!.shirt;
  w.setPerson(name, { ...lookFor(seat?.member?.platformId ?? name, shirt), tie: seat?.member?.follower ?? false });
  const home = seat ? { x: seat.x, y: seat.y + 38 * seat.s } : { x: 540, y: 1700 };
  return {
    w,
    /** Đi trong [a,b], đứng ở đích tới c, về ghế trong [c,d] (theo tiến trình p 0..1). */
    move(p: number, a: number, b: number, c: number, d: number, tx: number, ty: number) {
      const out = p >= a && p < d;
      w.visible = out;
      if (seat?.member) seat.person.visible = !out;
      if (!out) return;
      let k: number;
      if (p < b) {
        k = easeInOut(seg(p, a, b));
        w.walking = true;
        w.face(tx >= home.x ? 1 : -1);
      } else if (p < c) {
        k = 1;
        w.walking = false;
      } else {
        k = 1 - easeInOut(seg(p, c, d));
        w.walking = true;
        w.face(home.x >= tx ? 1 : -1);
      }
      w.x = lerp(home.x, tx, k);
      w.y = lerp(home.y, ty, k);
    },
    done() {
      if (seat?.member) seat.person.visible = true;
      s.removeWalker(w);
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Ném giấy — giấy bay từ đúng ghế người ném; Sếp né hoặc trúng rồi chỉ tay về phía đó.
// ---------------------------------------------------------------------------
const throwPaper: AnimFactory = (s, run) => {
  const seat = actorSeat(s, run);
  const fromX = seat?.x ?? 540;
  const fromY = seat ? seat.y - 62 * seat.s : 1200;
  const dodge = hash(run.runId) % 3 === 0;
  s.classroom.cheer(run.actor?.displayName, run.durationMs * 0.5);
  const paper = new Graphics();
  // cục giấy vo tròn (to, có nếp nhăn) — không phải viên phấn
  paper
    .rect(-12, -22, 24, 44).fill(INK).rect(-22, -12, 44, 24).fill(INK).rect(-18, -18, 36, 36).fill(INK)
    .rect(-10, -19, 20, 38).fill(0xf6f5f4).rect(-19, -10, 38, 20).fill(0xf6f5f4).rect(-15, -15, 30, 30).fill(0xf6f5f4)
    .rect(-12, -6, 10, 3).fill(0x9a9996).rect(2, -12, 3, 10).fill(0x9a9996).rect(-4, 4, 14, 3).fill(0x9a9996)
    .rect(6, 8, 8, 3).fill(0xc0bfbc).rect(-14, 6, 3, 8).fill(0xc0bfbc);
  const fx = bubble(dodge ? 'NÉ!' : 'BỐP!');
  fx.anchor.set(0.5);
  fx.visible = false;
  s.fx.addChild(paper, fx);
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      const fly = seg(p, 0.05, 0.4);
      const tx = SPOT.bossHome + (dodge ? 30 : 0);
      paper.visible = fly > 0 && (fly < 1 || dodge);
      paper.x = lerp(fromX, dodge ? tx + 300 * seg(p, 0.4, 0.6) : tx, fly);
      paper.y = lerp(fromY, SPOT.bossHeadY, fly) - Math.sin(fly * Math.PI) * 220 + (dodge ? 300 * seg(p, 0.4, 0.6) ** 2 : 0);
      paper.rotation = Math.floor(ms / 80) * 0.6;
      if (p < 0.38) pose(s, null);
      else if (p < 0.62) {
        if (dodge) {
          pose(s, 'shocked');
          s.boss.leanAngle = -0.2 * Math.sin(Math.PI * seg(p, 0.38, 0.62));
          s.boss.setExpression('shock');
        } else {
          pose(s, 'rage');
          s.boss.setExpression('hit');
        }
      } else if (p < 0.95) {
        s.boss.leanAngle = 0;
        s.boss.setExpression('angry');
        pose(s, 'scold');
        s.boss.scale.x = fromX < SPOT.bossHome ? -1 : 1;
      } else resetBoss(s);
      fx.visible = p > 0.4 && p < 0.8;
      fx.position.set(SPOT.bossHome + 110, 520 - 40 * seg(p, 0.4, 0.8));
    },
    finish() {
      paper.destroy();
      fx.destroy();
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 2. Vặt lá cây phát tài — nhân vật lẻn tới cây, vặt lá + lì xì; Sếp phát hiện, chạy tới ôm cây.
// ---------------------------------------------------------------------------
const pluckTree: AnimFactory = (s, run) => {
  const trip = makeTrip(s, run);
  const pick = bubble('Hái lộc nào!', 0xff6b35, 30);
  pick.anchor.set(0.5);
  const cry = bubble('CÂY PHÁT TÀI CỦA TAO!!');
  cry.anchor.set(0.5);
  cry.position.set(540, 470);
  const snap = bubble('PHỰT!', 0x26a269, 40);
  snap.anchor.set(0.5);
  // Lá cắt từ ảnh cây: đống lá dưới gốc (sau cùng trong fx) + các cụm lá bay ra sau mỗi cú giật.
  const PER_TUG = 6;
  const pile = new Sprite(s.tree.pileTex ?? Texture.EMPTY);
  pile.anchor.set(0.5, 1);
  pile.visible = false;
  const flying = new Container();
  const leafSprites: Sprite[] = [];
  s.fx.addChildAt(pile, 0);
  s.fx.addChild(pick, cry, snap, flying);
  const standX = TREE.x + 95;
  const dur = run.durationMs;
  // Pha vặt [P0,P1] gồm TUGS cú giật; mỗi cú: với tay (0..0.5) → giật (0.5) → cây rung + lá bắn ra.
  const P0 = 0.16;
  const P1 = 0.52;
  const TUGS = 4;
  const tugMs = ((P1 - P0) * dur) / TUGS;
  const canopyY = TREE.y - 175;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      trip.move(p, 0, P0, P1, 0.68, standX, SPOT.floorY + 20);
      const pulling = p >= P0 && p < P1;
      const tt = pulling ? seg(p, P0, P1) * TUGS : p >= P1 ? TUGS : 0;
      const tug = Math.min(TUGS - 1, Math.floor(tt));
      const f = tt - tug;
      const yanked = pulling ? tug + (f >= 0.5 ? 1 : 0) : p >= P1 ? TUGS : 0;
      // đứng cạnh cây thì đẩy bảng tên sang phải để không che tán cây
      trip.w.shiftTag(p > P0 * 0.6 && p < P1 + 0.06 ? trip.w.tagHalfW - 40 : 0);
      if (pulling) {
        trip.w.face(-1);
        // với tay lên cây rồi ngả người ra sau khi giật
        trip.w.pose(f < 0.5 ? 'cheer' : 'shout');
        trip.w.x += f < 0.5 ? -10 * seg(f, 0, 0.5) : -10 + 26 * Math.sin(Math.PI * seg(f, 0.5, 1));
      } else trip.w.pose(null);
      pick.visible = p > P0 && p < P0 + 0.12;
      pick.position.set(trip.w.x, trip.w.y - 240);

      // Cây: đổi khung theo số cú đã giật, rung mạnh ngay sau mỗi cú, mọc lại ở cuối
      const regrow = seg(p, 0.9, 1);
      s.tree.setLeaves(TREE.leaves * (1 - (yanked / TUGS) * (1 - regrow)));
      const since = pulling && f >= 0.5 ? (f - 0.5) * tugMs : Infinity;
      const shake = since < 450 ? Math.sin(since / 35) * (1 - since / 450) : 0;
      s.tree.root.rotation = shake * 0.09;
      s.tree.root.x = TREE.x + shake * 6;
      snap.visible = since < 380;
      snap.position.set(TREE.x + 30, canopyY - 60 - since * 0.06);

      // Cụm lá (ảnh thật) bắn ra từ tán sau mỗi cú giật, xoay và rơi xuống đất
      const tex = s.tree.leafTex;
      let used = 0;
      if (tex.length)
        for (let j = 0; j < yanked && j < TUGS; j++) {
          const age = ms - (P0 * dur + (j + 0.5) * tugMs);
          if (age < 0 || age > 1100) continue;
          const t = age / 1000;
          for (let i = 0; i < PER_TUG; i++) {
            const r = hash(`${run.runId}:${j}:${i}`);
            const sp = (leafSprites[used] ??= flying.addChild(new Sprite({ texture: tex[0]!, anchor: 0.5 })));
            used++;
            sp.texture = tex[(r >> 3) % tex.length]!;
            const vx = ((r % 200) - 60) * 2.2; // phần lớn bắn về phía người vặt (bên phải)
            const vy = -180 - ((r >> 8) % 220);
            sp.x = TREE.x + ((r >> 4) % 90) - 45 + vx * t;
            sp.y = Math.min(TREE.y - 12, canopyY + ((r >> 12) % 60) + vy * t + 900 * t * t);
            sp.rotation = (((r >> 6) % 2) * 2 - 1) * t * 6;
            sp.scale.set(0.28 + ((r >> 10) % 10) * 0.02);
            sp.alpha = age > 900 ? 1 - (age - 900) / 200 : 1;
            sp.visible = true;
          }
        }
      for (let i = used; i < leafSprites.length; i++) leafSprites[i]!.visible = false;

      // Đống lá dưới gốc lớn dần theo số cú, biến mất khi cây mọc lại
      const amount = (yanked / TUGS) * (1 - regrow);
      if (pile.texture === Texture.EMPTY && s.tree.pileTex) pile.texture = s.tree.pileTex;
      pile.visible = amount > 0 && pile.texture !== Texture.EMPTY;
      pile.position.set(TREE.x + 20, TREE.y + 4);
      pile.scale.set(0.12 + 0.3 * amount, 0.08 + 0.32 * amount);

      // Sếp: quay lại thấy → chạy tới cây → ôm cây tuyệt vọng → về chỗ
      if (p < 0.5) pose(s, null);
      else if (p < 0.58) {
        pose(s, 'shocked');
        s.boss.setExpression('shock');
      } else if (p < 0.7) {
        pose(s, null);
        s.boss.running = true;
        s.boss.setExpression('angry');
        walkBoss(s, SPOT.bossHome, TREE.x + 120, seg(p, 0.58, 0.7));
      } else if (p < 0.86) {
        s.boss.walking = false;
        s.boss.running = false;
        s.boss.x = TREE.x + 120;
        s.boss.scale.x = -1;
        pose(s, 'despair');
        s.boss.setExpression('helpless');
      } else {
        pose(s, null);
        walkBoss(s, TREE.x + 120, SPOT.bossHome, seg(p, 0.86, 0.98));
      }
      cry.visible = p > 0.52 && p < 0.76;
      cry.position.y = 470 + (Math.floor(ms / 90) % 2) * 5;
    },
    finish() {
      trip.done();
      s.tree.setLeaves(TREE.leaves);
      s.tree.root.rotation = 0;
      s.tree.root.x = TREE.x;
      pick.destroy();
      cry.destroy();
      snap.destroy();
      pile.destroy();
      flying.destroy();
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 3. Vẽ bậy lên bảng KPI — Sếp mải nghe điện thoại; nhân vật lên vẽ biếm hoạ "SẾP HÓI";
//    Sếp quay lại thấy, nổi điên, xoá bảng.
// ---------------------------------------------------------------------------
const doodleKpi: AnimFactory = (s, run) => {
  const trip = makeTrip(s, run);
  const sketch = bubble('Xoẹt xoẹt...', 0x1c71d8, 30);
  sketch.anchor.set(0.5);
  const angry = bubble('AI VẼ ĐẤY?!');
  angry.anchor.set(0.5);
  angry.position.set(SPOT.bossHome + 150, 500);
  s.fx.addChild(sketch, angry);
  const standX = KPI_BOARD.x + 70;
  const away = SPOT.bossHome + 170;
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      trip.move(p, 0, 0.16, 0.44, 0.6, standX, SPOT.floorY + 10);
      trip.w.pose(p >= 0.18 && p < 0.42 ? 'tablet' : null);
      sketch.visible = p > 0.18 && p < 0.42;
      sketch.position.set(trip.w.x + 40, trip.w.y - 240);
      // vẽ dần trong lúc đứng ở bảng; Sếp xoá ở cuối
      s.doodle.reveal(easeInOut(seg(p, 0.18, 0.42)));
      s.doodle.root.alpha = 1 - seg(p, 0.86, 0.96);
      if (p < 0.08) pose(s, null);
      else if (p < 0.46) {
        // Sếp quay lưng ra góc nghe điện thoại
        pose(s, 'phone');
        walkBoss(s, SPOT.bossHome, away, seg(p, 0.02, 0.1));
      } else if (p < 0.56) {
        s.boss.x = away;
        s.boss.walking = false;
        s.boss.scale.x = -1;
        pose(s, 'shocked');
        s.boss.setExpression('shock');
      } else if (p < 0.84) {
        s.boss.x = away;
        s.boss.scale.x = -1;
        pose(s, 'rage');
        s.boss.setExpression('angry');
        s.boss.shakeAmount = 3;
      } else {
        s.boss.shakeAmount = 0;
        pose(s, null);
        walkBoss(s, away, SPOT.bossHome, seg(p, 0.84, 0.98));
      }
      angry.visible = p > 0.5 && p < 0.82;
    },
    finish() {
      trip.done();
      s.doodle.reveal(0);
      s.doodle.root.alpha = 1;
      sketch.destroy();
      angry.destroy();
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 9. Ngắt cầu dao — nhân vật gạt cầu dao, văn phòng tối om; Sếp hoảng loạn trong bóng tối,
//    điện chập chờn có lại, Sếp nổi điên.
// ---------------------------------------------------------------------------
const blackout: AnimFactory = (s, run) => {
  const trip = makeTrip(s, run);
  const { darkness } = s.breaker;
  const clack = bubble('CẠCH!', 0x8f5b00, 34);
  clack.anchor.set(0.5);
  clack.position.set(BREAKER.x, BREAKER.y - 70);
  const who = bubble('AI TẮT ĐIỆN?!', 0xe01b24, 46);
  who.anchor.set(0.5);
  who.position.set(540, 520);
  const giggle = bubble('Hí hí...', 0xffd166, 30);
  giggle.anchor.set(0.5);
  const eyes = new Graphics();
  s.fx.addChild(clack, who, giggle, eyes);
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      trip.move(p, 0, 0.14, 0.22, 0.4, BREAKER.x + 30, SPOT.floorY + 10);
      s.breaker.setOff(p > 0.18 && p < 0.72);
      clack.visible = p > 0.18 && p < 0.26;
      // tối dần; cuối pha điện chập chờn rồi sáng lại
      let a = 0;
      if (p > 0.18 && p < 0.66) a = 0.82 * seg(p, 0.18, 0.22);
      else if (p >= 0.66 && p < 0.74) a = Math.floor(ms / 90) % 2 ? 0.82 : 0.2;
      darkness.visible = a > 0;
      darkness.alpha = a;
      // trong bóng tối chỉ thấy mắt Sếp đảo qua lại
      eyes.clear();
      if (p > 0.26 && p < 0.66) {
        const ex = SPOT.bossHome + Math.sin(ms / 300) * 30;
        eyes.rect(ex - 22, 590, 12, 12).fill(0xffffff).rect(ex + 10, 590, 12, 12).fill(0xffffff);
      }
      who.visible = p > 0.3 && p < 0.64;
      giggle.visible = p > 0.24 && p < 0.38;
      giggle.position.set(trip.w.x, trip.w.y - 230);
      if (p < 0.2) pose(s, null);
      else if (p < 0.66) {
        pose(s, 'sos');
        s.bossDesk.visible = !s.boss.hasSprites;
        s.boss.setExpression('panic');
        s.boss.shakeAmount = 2;
      } else if (p < 0.94) {
        s.bossDesk.visible = true;
        s.boss.shakeAmount = 3;
        pose(s, 'rage');
        s.boss.setExpression('angry');
      } else resetBoss(s);
    },
    finish() {
      trip.done();
      s.breaker.setOff(false);
      darkness.visible = false;
      darkness.alpha = 0;
      clack.destroy();
      who.destroy();
      giggle.destroy();
      eyes.destroy();
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 4. Xịt lốp xe Sếp — CẢNH CẮT ra bãi đỗ xe: nhân viên (có bảng tên) lẻn tới xịt lốp,
//    Sếp chạy ra nổi điên rồi đành đi xe máy về.
// ---------------------------------------------------------------------------
const flatTire: AnimFactory = (s, run) => {
  const P = s.parking;
  const { rearWheel, puff, root: car } = P.car;
  const name = run.actor?.displayName ?? 'Nhân viên ẩn danh';
  const seat = s.classroom.seatOf(name);
  const shirt = DEPARTMENTS[seat?.dept ?? hash(name) % DEPARTMENTS.length]!.shirt;
  P.walker.setPerson(name, { ...lookFor(seat?.member?.platformId ?? name, shirt), tie: seat?.member?.follower ?? false });
  // Nhân vật của người xịt đang ở bãi xe → ghế trống.
  if (seat?.member) seat.person.visible = false;
  let wheelX = car.x + rearWheel.x * car.scale.x;
  let groundY = car.y + 6 * car.scale.y;
  let sprayX = wheelX - 70 * car.scale.x;
  const spray = new Graphics();
  const hiss = bubble('XÌÌÌ...', 0x3d405b);
  hiss.anchor.set(0.5);
  const giggle = bubble('Hí hí!', 0xff6b35, 40);
  giggle.anchor.set(0.5);
  const yell = bubble('XE CỦA TAOOO!');
  yell.anchor.set(0.5);
  const bye = bubble('Thôi đi xe máy vậy...', 0x3d405b, 34);
  bye.anchor.set(0.5);
  P.fx.addChild(spray, hiss, giggle, yell, bye);
  const dur = run.durationMs;

  const showParking = (on: boolean) => {
    P.root.visible = on;
    s.office.visible = !on;
  };

  return {
    update(ms) {
      // ảnh bãi xe/xe tải xong có thể dời xe → tính lại vị trí mỗi khung
      wheelX = car.x + rearWheel.x * car.scale.x;
      groundY = car.y + 6 * car.scale.y;
      sprayX = wheelX - 70 * car.scale.x;
      const p = clamp01(ms / dur);
      // --- chuyển cảnh: tối dần → bãi xe → tối dần → văn phòng ---
      const fadeA =
        p < 0.06 ? seg(p, 0, 0.06) : p < 0.12 ? 1 - seg(p, 0.06, 0.12) : p < 0.92 ? 0 : p < 0.96 ? seg(p, 0.92, 0.96) : 1 - seg(p, 0.96, 1);
      s.fade.visible = fadeA > 0;
      s.fade.alpha = fadeA;
      showParking(p >= 0.06 && p < 0.96);
      s.banner.visible = p > 0.08 && p < 0.3;
      s.bannerText.text = 'BÃI ĐỖ XE CÔNG TY';
      if (!P.root.visible) return;

      // --- nhân viên lẻn tới, xịt, cười rồi chạy ---
      const w = P.walker;
      w.visible = p < 0.72;
      w.y = groundY;
      if (p < 0.34) {
        w.walking = true;
        w.face(1);
        w.crouch(0);
        w.x = lerp(-90, sprayX, easeInOut(seg(p, 0.1, 0.34)));
      } else if (p < 0.58) {
        w.walking = false;
        w.x = sprayX;
        w.crouch(1);
      } else {
        w.crouch(0);
        w.walking = p > 0.6;
        w.face(-1);
        w.x = lerp(sprayX, -120, easeIn(seg(p, 0.6, 0.72)));
      }
      w.can.visible = p >= 0.34 && p < 0.58;
      spray.clear();
      if (p >= 0.36 && p < 0.58)
        for (let i = 0; i < 6; i++) {
          const k = (ms / 300 + i / 6) % 1;
          spray.rect(sprayX + 30 + k * 40, groundY - 50 + Math.sin(i * 7) * 10 * k, 6, 6).fill({ color: 0xffffff, alpha: 1 - k });
        }

      // --- lốp xẹp ---
      const flat = easeOut(seg(p, 0.38, 0.56));
      rearWheel.scale.set(1 + 0.2 * flat, 1 - 0.55 * flat);
      car.rotation = -0.05 * flat;
      puff.alpha = p > 0.38 && p < 0.62 ? (Math.floor(ms / 120) % 2 ? 1 : 0.5) : 0;
      hiss.visible = p > 0.38 && p < 0.58;
      hiss.position.set(wheelX, groundY - 130 + (Math.floor(ms / 100) % 2) * 4);
      giggle.visible = p > 0.58 && p < 0.7;
      giggle.position.set(Math.max(80, w.x), groundY - 240);

      // --- Sếp chạy ra ---
      const b = P.boss;
      b.visible = p > 0.62 && p < 0.94;
      if (b.visible) {
        if (p < 0.66) {
          b.position.set(P.doorX, P.doorY);
          b.setPose('shocked');
          b.setExpression('shock');
        } else if (p < 0.76) {
          b.walking = true;
          b.running = true;
          b.setPose(null);
          b.setExpression('angry');
          b.position.set(lerp(P.doorX, car.x + 120, seg(p, 0.66, 0.76)), lerp(P.doorY, groundY - 150, seg(p, 0.66, 0.76)));
        } else if (p < 0.85) {
          b.walking = false;
          b.walking = false;
          b.running = false;
          b.setPose('rage');
          b.setExpression('angry');
          b.shakeAmount = 4;
        } else {
          b.shakeAmount = 0;
          b.setPose('motorbike');
          b.setExpression('helpless');
          b.scale.x = 1;
          b.x = lerp(car.x + 120, 1300, easeIn(seg(p, 0.85, 0.94)));
        }
      }
      yell.visible = p > 0.76 && p < 0.86;
      yell.position.set(car.x + 60, groundY - 440 + (Math.floor(ms / 90) % 2) * 6);
      bye.visible = p > 0.86 && p < 0.93;
      bye.position.set(Math.min(880, b.x), groundY - 420);
    },
    finish() {
      showParking(false);
      if (seat?.member) seat.person.visible = true;
      s.fade.visible = false;
      s.fade.alpha = 0;
      s.banner.visible = false;
      rearWheel.scale.set(1);
      car.rotation = 0;
      puff.alpha = 0;
      P.walker.visible = false;
      P.walker.can.visible = false;
      P.boss.visible = false;
      P.boss.setPose(null);
      P.boss.setExpression(null);
      P.boss.shakeAmount = 0;
      P.boss.walking = false;
      P.boss.running = false;
      P.boss.scale.x = 1;
      spray.destroy();
      hiss.destroy();
      giggle.destroy();
      yell.destroy();
      bye.destroy();
    }
  };
};

// ---------------------------------------------------------------------------
// 5. Khóa nhà vệ sinh — Sếp tới WC, cửa khoá, lay cửa, bỏ chạy ra lối thoát rồi lết về.
// ---------------------------------------------------------------------------
const lockToilet: AnimFactory = (s, run) => {
  const fx = bubble('!!!');
  fx.anchor.set(0.5);
  fx.visible = false;
  const click = bubble('CẠCH!', 0x8f5b00, 34);
  click.anchor.set(0.5);
  click.position.set(SPOT.wcDoor, SPOT.wcLockY - 90);
  s.fx.addChild(fx, click);
  // Người khoá WC tự đi tới cửa, bấm khoá rồi chuồn về chỗ.
  const trip = makeTrip(s, run);
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      trip.move(p, 0, 0.15, 0.2, 0.34, SPOT.wcDoor - 70, SPOT.floorY + 20);
      s.wcLock.visible = p > 0.16 && p < 0.95;
      click.visible = p > 0.16 && p < 0.24;
      if (p < 0.3) pose(s, null);
      else if (p < 0.46) {
        walkBoss(s, SPOT.bossHome, SPOT.wcDoor - 90, seg(p, 0.3, 0.46));
      } else if (p < 0.62) {
        s.boss.walking = false;
        pose(s, 'shocked');
        s.boss.setExpression('panic');
        s.wcDoor.x = s.wcLock.x = SPOT.wcDoor + (Math.floor(ms / 60) % 2 ? 6 : -6);
        fx.visible = true;
        fx.position.set(SPOT.wcDoor - 90, 480);
      } else if (p < 0.8) {
        s.wcDoor.x = s.wcLock.x = SPOT.wcDoor;
        fx.visible = false;
        pose(s, null);
        s.boss.running = true;
        walkBoss(s, SPOT.wcDoor - 90, SPOT.exitDoor, seg(p, 0.62, 0.76));
        s.boss.alpha = 1 - seg(p, 0.74, 0.8);
      } else {
        s.boss.running = false;
        s.boss.setExpression('helpless');
        s.boss.alpha = seg(p, 0.82, 0.85);
        if (p < 0.96) walkBoss(s, SPOT.exitDoor, SPOT.bossHome, seg(p, 0.82, 0.96));
        else {
          s.boss.walking = false;
          s.boss.scale.x = 1;
          pose(s, 'weary');
        }
      }
    },
    finish() {
      trip.done();
      click.destroy();
      s.wcLock.visible = false;
      s.wcDoor.x = s.wcLock.x = SPOT.wcDoor;
      fx.destroy();
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 6. Đình công toàn công ty — Sếp gọi cứu trợ; nhân viên giơ biển, kéo nhau ra cửa.
// ---------------------------------------------------------------------------
const strike: AnimFactory = (s, run) => {
  const banner = bubble('ĐÌNH CÔNG!!!');
  banner.anchor.set(0.5);
  banner.position.set(540, 860);
  banner.scale.set(1.4);
  s.fx.addChild(banner);
  const seats = s.classroom.occupied();
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      banner.visible = p < 0.8;
      banner.scale.set(1.4 + (Math.floor(ms / 200) % 2) * 0.06);
      seats.forEach((st, i) => {
        const delay = (i % 12) * 0.02;
        st.sign.visible = p > 0.05 && p < 0.85;
        st.sign.y = -60 - (Math.floor(ms / 150 + i) % 2) * 10;
        const out = easeInOut(seg(p, 0.2 + delay, 0.55 + delay));
        const back = easeInOut(seg(p, 0.8, 0.98));
        const k = out * (1 - back);
        // đi về phía cửa thoát hiểm (toạ độ bên trong ghế đã thu nhỏ)
        st.person.x = lerp(0, (SPOT.exitDoor - st.x) / st.s, k);
        st.person.y = lerp(0, (SPOT.floorY - st.y) / st.s, k);
        st.person.alpha = 1 - 0.9 * seg(p, 0.45 + delay, 0.6 + delay) * (1 - back);
      });
      if (p < 0.5) {
        // Sếp ngồi bàn gọi cứu trợ (ảnh đã có bàn → ẩn bàn vẽ sẵn)
        s.bossDesk.visible = !s.boss.hasSprites;
        pose(s, 'sos');
        s.boss.setExpression('panic');
        s.boss.shakeAmount = 2;
      } else if (p < 0.8) {
        s.bossDesk.visible = true;
        pose(s, null);
        const r = seg(p, 0.5, 0.8);
        s.boss.x = SPOT.bossHome + Math.sin(r * Math.PI * 4) * 200;
        s.boss.walking = true;
        s.boss.running = true;
        s.boss.scale.x = Math.cos(r * Math.PI * 4) >= 0 ? 1 : -1;
      } else {
        s.boss.x = SPOT.bossHome;
        s.boss.walking = false;
        s.boss.scale.x = 1;
        pose(s, 'despair');
        s.boss.setExpression('helpless');
      }
    },
    finish() {
      banner.destroy();
      for (const st of s.classroom.seats) {
        st.sign.visible = false;
        st.person.position.set(0, 0);
        st.person.alpha = 1;
      }
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 7. Làm treo máy tính Sếp — Sếp ra góc phòng loay hoay với máy tính hỏng.
// ---------------------------------------------------------------------------
const crashPc: AnimFactory = (s, run) => {
  const err = bubble('LỖI 404!', 0x3584e4, 40);
  err.anchor.set(0.5);
  err.position.set(SPOT.bossHome + 40, 480);
  const q = bubble('???', 0x3d405b, 40);
  q.anchor.set(0.5);
  q.position.set(SPOT.bossHome - 60, 440);
  s.fx.addChild(err, q);
  // Người phá tự lẻn lên rút phích máy tính của Sếp rồi chuồn về.
  const trip = makeTrip(s, run);
  // Ảnh "gõ máy" và "máy hỏng" đã có bàn riêng → ẩn bàn + cốc vẽ sẵn trong lúc diễn.
  const ownDesk = (on: boolean) => {
    s.bossDesk.visible = !on;
    s.coffee.cup.visible = !on;
  };
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      trip.move(p, 0, 0.14, 0.24, 0.38, SPOT.bossHome - 210, SPOT.floorY + 20);
      trip.w.crouch(p > 0.14 && p < 0.24 ? 1 : 0);
      if (p < 0.42 && hasClip('desk')) {
        ownDesk(true);
        pose(s, 'desk');
        s.boss.setExpression(p < 0.24 ? null : 'shock');
      } else if (p < 0.72) {
        ownDesk(s.boss.hasSprites);
        pose(s, 'computer');
        s.boss.setExpression('shock');
      } else if (p < 0.95) {
        ownDesk(false);
        pose(s, 'rage');
        s.boss.setExpression('angry');
      } else {
        ownDesk(false);
        resetBoss(s);
      }
      err.visible = p > 0.24 && p < 0.72 && Math.floor(ms / 200) % 2 === 0;
      q.visible = p > 0.45 && p < 0.72;
    },
    finish() {
      trip.done();
      ownDesk(false);
      err.destroy();
      q.destroy();
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 8. Khách gọi phàn nàn — Sếp nghe máy, hét lên, ném tung tài liệu.
// ---------------------------------------------------------------------------
const complaintCall: AnimFactory = (s, run) => {
  const ring = bubble('REENG REENG!', 0x3584e4, 36);
  ring.anchor.set(0.5);
  ring.position.set(SPOT.bossHome, 480);
  const what = bubble('CÁI GÌ?!');
  what.anchor.set(0.5);
  what.position.set(SPOT.bossHome + 120, 500);
  const docs = new Graphics();
  s.fx.addChild(ring, what, docs);
  s.classroom.cheer(run.actor?.displayName, 2000);
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      ring.visible = p < 0.14 && Math.floor(ms / 150) % 2 === 0;
      what.visible = p > 0.35 && p < 0.55;
      if (p < 0.35) {
        pose(s, 'phone');
        s.boss.setExpression(p < 0.15 ? null : 'annoyed');
      } else if (p < 0.55) {
        pose(s, hasClip('phone') ? 'phone' : 'shouting');
        s.boss.setExpression('angry');
      } else if (p < 0.92) {
        pose(s, hasClip('paper') ? 'paper' : 'throw_docs');
        s.boss.setExpression('angry');
      } else resetBoss(s);
      docs.clear();
      const f = seg(p, 0.55, 0.95);
      if (f > 0 && f < 1 && !hasClip('paper'))
        for (let i = 0; i < 6; i++) {
          const k = clamp01(f * 1.3 - i * 0.05);
          const x = SPOT.bossHome + 80 + k * (120 + i * 60);
          const y = 560 - Math.sin(k * Math.PI) * (80 + i * 20) + k * 200;
          docs.rect(x, y, 26, 32).fill(INK).rect(x + 3, y + 3, 20, 26).fill(0xffffff);
        }
    },
    finish() {
      ring.destroy();
      what.destroy();
      docs.destroy();
      resetBoss(s);
    }
  };
};

// ---------------------------------------------------------------------------
// 9. Nịnh Sếp — Sếp khoái chí giơ ngón cái, tim bay lên (hồi lại chút bình tĩnh).
// ---------------------------------------------------------------------------
const praiseBoss: AnimFactory = (s, run) => {
  const who = run.actor?.displayName ?? 'Cậu';
  const say = bubble(`Khá lắm, ${[...who].slice(0, 12).join('')}!`, 0x26a269, 34);
  say.anchor.set(0.5);
  say.position.set(SPOT.bossHome, 470);
  const hearts = new Graphics();
  s.fx.addChild(hearts, say);
  const flatter = bubble('Sếp đẹp trai quá ạ!', 0xff6b35, 30);
  flatter.anchor.set(0.5);
  s.fx.addChild(flatter);
  // Người nịnh tự đi lên tận nơi khen Sếp.
  const trip = makeTrip(s, run);
  const dur = run.durationMs;
  return {
    update(ms) {
      const p = clamp01(ms / dur);
      trip.move(p, 0, 0.22, 0.62, 0.86, SPOT.bossHome + 170, SPOT.floorY + 30);
      trip.w.pose(p >= 0.22 && p < 0.62 ? 'cheer' : null);
      flatter.visible = p > 0.22 && p < 0.45;
      flatter.position.set(trip.w.x, trip.w.y - 230);
      pose(s, p > 0.3 && p < 0.92 ? 'pleased' : null);
      s.boss.setExpression(p < 0.92 ? 'normal' : null);
      say.visible = p > 0.45 && p < 0.85;
      hearts.clear();
      if (p < 0.3) return;
      for (let i = 0; i < 5; i++) {
        const k = (p * 2 + i / 5) % 1;
        const x = SPOT.bossHome - 120 + i * 60;
        const y = 640 - k * 200;
        const a = 1 - k;
        hearts.rect(x, y, 8, 8).fill({ color: 0xe01b24, alpha: a }).rect(x + 12, y, 8, 8).fill({ color: 0xe01b24, alpha: a });
        hearts.rect(x - 4, y + 6, 28, 8).fill({ color: 0xe01b24, alpha: a }).rect(x + 4, y + 14, 12, 8).fill({ color: 0xe01b24, alpha: a });
      }
    },
    finish() {
      trip.done();
      flatter.destroy();
      hearts.destroy();
      say.destroy();
      resetBoss(s);
    }
  };
};

/** Hành động mới cấu hình thêm mà chưa có hoạt ảnh riêng: Sếp rung + hiện tên hành động. */
const generic: AnimFactory = (s, run) => {
  const t = bubble(run.actionName, 0x3d405b);
  t.anchor.set(0.5);
  t.position.set(SPOT.bossHome, 480);
  s.fx.addChild(t);
  s.classroom.cheer(run.actor?.displayName, 2000);
  return {
    update(ms) {
      s.boss.shakeAmount = 3;
      s.boss.setPose('shocked');
      t.alpha = 1 - seg(ms / run.durationMs, 0.7, 1);
    },
    finish() {
      t.destroy();
      resetBoss(s);
    }
  };
};

export const ANIMATIONS: Record<string, AnimFactory> = {
  throw_paper: throwPaper,
  pluck_tree: pluckTree,
  doodle_kpi: doodleKpi,
  flat_tire: flatTire,
  lock_toilet: lockToilet,
  crash_pc: crashPc,
  complaint_call: complaintCall,
  praise_boss: praiseBoss,
  blackout,
  strike
};

/** Thời lượng mặc định (khớp cấu hình server) — dùng cho chế độ xem trước. */
export const PREVIEW_DURATIONS: Record<string, number> = {
  throw_paper: 3000,
  pluck_tree: 7000,
  doodle_kpi: 7000,
  flat_tire: 9000,
  lock_toilet: 8000,
  crash_pc: 8000,
  complaint_call: 6000,
  praise_boss: 5000,
  blackout: 8000,
  strike: 9000
};

export function createAnim(s: SceneRefs, run: RunningAction): ActionAnim {
  return (ANIMATIONS[run.actionId] ?? generic)(s, run);
}
