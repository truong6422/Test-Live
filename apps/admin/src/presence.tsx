import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameSnapshot } from '@cau/shared';
import { api } from './api';
import type { Notify, Run } from './App';

/**
 * "Chủ phòng có mặt" — chỉ chạy trong trình duyệt, không gửi gì lên server (trừ lệnh dừng game có sẵn).
 *
 * TikTok cấm LIVE treo máy / tự động hoá: trò chơi chỉ là phần phụ, chủ phòng phải dẫn trực tiếp.
 * - Mọi thao tác trên trang (bấm, gõ) hoặc nút "Tôi đang ở đây" = xác nhận có mặt.
 * - Đang nối TikTok LIVE thật mà quá `intervalMin` phút không xác nhận → cảnh báo nổi bật.
 * - Thêm GRACE_MS nữa vẫn không xác nhận và game đang chạy → tự DỪNG game (API có sẵn) + nhắc dùng
 *   "Tạm dừng LIVE" của TikTok hoặc kết thúc LIVE khi rời máy.
 * - Hồ trống và không có sự kiện nào trong EMPTY_ROOM_MS khi đang LIVE → nhắc trò chuyện / kết thúc LIVE.
 * Khoảng nhắc lưu ở localStorage (`cau-admin.presence.intervalMin`, 0 = tắt).
 */

const KEY_INTERVAL = 'cau-admin.presence.intervalMin';
const KEY_ONAIR = 'cau-admin.onair';
export const PRESENCE_OPTIONS = [5, 10, 15, 20, 30, 0] as const;
const DEFAULT_INTERVAL_MIN = 10;
export const GRACE_MS = 3 * 60_000;
const EMPTY_ROOM_MS = 10 * 60_000;
const CHECK_MS = 5_000;

export type PresencePhase = 'ok' | 'warn' | 'paused';

interface OnAir {
  /** Mốc nối TikTok LIVE (giờ máy) — null nếu đang không nối. */
  liveSince: number | null;
  /** Mốc game bắt đầu chạy (giờ máy, theo dõi phía trình duyệt). */
  gameSince: number | null;
}

export interface Presence {
  /** Đang nối TikTok LIVE thật (không demo) → các nhắc nhở có hiệu lực. */
  active: boolean;
  phase: PresencePhase;
  /** Mốc hết hạn xác nhận → bắt đầu cảnh báo. */
  warnAt: () => number;
  lastSeen: () => number;
  confirm: () => void;
  intervalMin: number;
  setIntervalMin: (m: number) => void;
  onAir: OnAir;
  emptyRoomMin: number;
}

const Ctx = createContext<Presence | null>(null);
export const usePresence = () => {
  const p = useContext(Ctx);
  if (!p) throw new Error('PresenceProvider thiếu');
  return p;
};

function readInterval(): number {
  try {
    const raw = localStorage.getItem(KEY_INTERVAL);
    if (raw === null) return DEFAULT_INTERVAL_MIN;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 120 ? n : DEFAULT_INTERVAL_MIN;
  } catch {
    return DEFAULT_INTERVAL_MIN;
  }
}

function readOnAir(): OnAir {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_ONAIR) ?? 'null') as Partial<OnAir> | null;
    return { liveSince: typeof v?.liveSince === 'number' ? v.liveSince : null, gameSince: typeof v?.gameSince === 'number' ? v.gameSince : null };
  } catch {
    return { liveSince: null, gameSince: null };
  }
}

export function PresenceProvider({
  snap,
  run,
  notify,
  children
}: {
  snap: GameSnapshot | null;
  run: Run;
  notify: Notify;
  children: ReactNode;
}) {
  const tiktokOn = snap?.connectors.tiktok.status === 'connected';
  const demo = !!snap?.connectors.demo.running;
  const running = !!snap?.running;
  const active = !!snap && tiktokOn && !demo;

  const [intervalMin, setIntervalState] = useState(readInterval);
  const setIntervalMin = useCallback((m: number) => {
    setIntervalState(m);
    try {
      localStorage.setItem(KEY_INTERVAL, String(m));
    } catch {
      /* chế độ riêng tư: chỉ giữ trong bộ nhớ */
    }
  }, []);

  // ---- Đồng hồ "lên sóng": nhớ mốc nối LIVE / bắt đầu game (giữ qua F5 nhờ localStorage). ----
  const [onAir, setOnAir] = useState<OnAir>(readOnAir);
  useEffect(() => {
    if (!snap) return;
    setOnAir((o) => {
      const next: OnAir = {
        liveSince: tiktokOn ? (o.liveSince ?? Date.now()) : null,
        gameSince: running ? (o.gameSince ?? Date.now()) : null
      };
      if (next.liveSince === o.liveSince && next.gameSince === o.gameSince) return o;
      try {
        localStorage.setItem(KEY_ONAIR, JSON.stringify(next));
      } catch {
        /* bỏ qua */
      }
      return next;
    });
  }, [snap, tiktokOn, running]);

  // ---- Xác nhận có mặt ----
  const lastSeenRef = useRef(Date.now());
  const [phase, setPhase] = useState<PresencePhase>('ok');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const confirm = useCallback(() => {
    lastSeenRef.current = Date.now();
    if (phaseRef.current !== 'ok') setPhase('ok');
  }, []);
  useEffect(() => {
    const opts = { passive: true, capture: true } as const;
    window.addEventListener('pointerdown', confirm, opts);
    window.addEventListener('keydown', confirm, opts);
    return () => {
      window.removeEventListener('pointerdown', confirm, opts);
      window.removeEventListener('keydown', confirm, opts);
    };
  }, [confirm]);
  // Vừa bắt đầu LIVE → tính lại từ bây giờ.
  useEffect(() => {
    if (active) confirm();
  }, [active, confirm]);

  // ---- Hồ trống / không có sự kiện ----
  const lastEventRef = useRef(Date.now());
  const feedHead = snap?.feed[0]?.id;
  const rosterLen = snap?.roster.length ?? 0;
  useEffect(() => {
    lastEventRef.current = Date.now();
  }, [feedHead, rosterLen > 0, active]);
  const [emptyRoomMin, setEmptyRoomMin] = useState(0);

  // ---- Kiểm tra định kỳ: state chỉ đổi khi chuyển trạng thái → không vẽ lại cả trang mỗi giây. ----
  const live = useRef({ active, running, rosterLen, intervalMin, run, notify });
  live.current = { active, running, rosterLen, intervalMin, run, notify };
  const stopping = useRef(false);
  useEffect(() => {
    const check = () => {
      const s = live.current;
      const now = Date.now();
      if (!s.active || s.intervalMin <= 0) {
        if (phaseRef.current !== 'ok') setPhase('ok');
      } else {
        const idle = now - lastSeenRef.current;
        const warnMs = s.intervalMin * 60_000;
        if (idle >= warnMs + GRACE_MS) {
          if (phaseRef.current !== 'paused' && s.running && !stopping.current) {
            stopping.current = true;
            void s
              .run(api.stopGame)
              .then((r) => {
                if (r) {
                  s.notify(
                    `Đã tự DỪNG game vì ${Math.round(idle / 60_000)} phút không thấy chủ phòng xác nhận có mặt. Khi rời máy, hãy dùng "Tạm dừng LIVE" của TikTok hoặc kết thúc LIVE.`,
                    'error'
                  );
                  setPhase('paused');
                }
              })
              .finally(() => {
                stopping.current = false;
              });
          } else if (phaseRef.current === 'ok') setPhase('warn');
        } else if (idle >= warnMs) {
          if (phaseRef.current === 'ok') setPhase('warn');
        }
      }
      const empty = s.active && s.rosterLen === 0 ? now - lastEventRef.current : 0;
      const em = empty >= EMPTY_ROOM_MS ? Math.floor(empty / 60_000) : 0;
      setEmptyRoomMin((x) => (x === em ? x : em));
    };
    const t = setInterval(check, CHECK_MS);
    return () => clearInterval(t);
  }, []);

  const value = useMemo<Presence>(
    () => ({
      active,
      phase,
      warnAt: () => lastSeenRef.current + intervalMin * 60_000,
      lastSeen: () => lastSeenRef.current,
      confirm,
      intervalMin,
      setIntervalMin,
      onAir,
      emptyRoomMin
    }),
    [active, phase, intervalMin, setIntervalMin, confirm, onAir, emptyRoomMin]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** "1:05:09" / "4:07" */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "vừa xong" / "3 phút trước" */
export function fmtAgo(ms: number): string {
  if (ms < 60_000) return 'vừa xong';
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m} phút trước` : `${Math.floor(m / 60)} giờ ${m % 60} phút trước`;
}
