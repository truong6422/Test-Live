import { useEffect, useRef, useState } from 'react';
import type { CatchEvent, GameSnapshot, HistoryEntry, ServerMessage } from '@cau/shared';
import { api, ApiError } from './api';

const CATCHES_MAX = 40;
const HISTORY_MAX = 200;
/**
 * Gom tin WS rồi cập nhật state một lần mỗi chừng này ms. Mỗi chu kỳ câu server bắn nhiều tin liền nhau
 * (roster, leaderboard, feed, catches…) — cập nhật từng tin sẽ render lại cả trang nhiều lần liên tiếp.
 * Dùng setTimeout (không dùng requestAnimationFrame: tab ẩn thì rAF dừng và hàng chờ phình mãi).
 */
const FLUSH_MS = 120;
/** Mất kết nối liên tiếp từng này lần → hỏi /auth/me xem có phải hết phiên đăng nhập không. */
const AUTH_CHECK_AFTER = 2;

/** Trạng thái realtime qua /ws/admin (xác thực bằng cookie phiên). */
export function useLive(enabled: boolean, onAuthLost: () => void) {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /** Cá vừa lên gần đây (mới nhất trước) — từ tin 'catches' mỗi chu kỳ. */
  const [catches, setCatches] = useState<CatchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  /** Tăng mỗi lần (kết nối lại) WS thành công — trang nào cần tải lại dữ liệu bỏ lỡ thì theo dõi số này. */
  const [epoch, setEpoch] = useState(0);
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;

  useEffect(() => {
    if (!enabled) {
      // Đăng xuất / hết phiên: bỏ dữ liệu cũ để lần đăng nhập sau không hiện trạng thái cũ.
      setSnap(null);
      setHistory([]);
      setCatches([]);
      setConnected(false);
      return;
    }
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let retry = 0;
    let queue: ServerMessage[] = [];

    const flush = () => {
      flushTimer = undefined;
      const msgs = queue;
      queue = [];
      let newHistory: HistoryEntry[] = [];
      let newCatches: CatchEvent[] = [];
      let snapshot: GameSnapshot | null = null;
      const patches: ServerMessage[] = [];
      for (const m of msgs) {
        if (m.type === 'snapshot') {
          snapshot = m.data;
          patches.length = 0; // snapshot đầy đủ thay thế mọi bản vá trước nó
        } else if (m.type === 'history') newHistory = [m.data, ...newHistory];
        else if (m.type === 'catches') newCatches = [...m.data].reverse().concat(newCatches);
        else patches.push(m);
      }
      if (snapshot || patches.length) {
        setSnap((s) => {
          let next = snapshot ?? s;
          if (!next) return next;
          for (const p of patches) next = apply(next, p);
          return next;
        });
      }
      if (newHistory.length) setHistory((h) => newHistory.concat(h).slice(0, HISTORY_MAX));
      if (newCatches.length) setCatches((c) => newCatches.concat(c).slice(0, CATCHES_MAX));
    };

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/admin`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        setEpoch((e) => e + 1);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry += 1;
        // Server từ chối nâng cấp WS khi cookie hết hạn (sau 12 giờ) — trình duyệt chỉ thấy "đóng".
        if (retry >= AUTH_CHECK_AFTER) {
          api.me().catch((err) => {
            if (!closed && err instanceof ApiError && err.status === 401) authLost.current();
          });
        }
        timer = setTimeout(open, Math.min(10_000, 500 * 2 ** retry));
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        queue.push(msg);
        flushTimer ??= setTimeout(flush, FLUSH_MS);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(flushTimer);
      queue = [];
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
      }
    };
  }, [enabled]);

  return { snap, history, catches, connected, epoch };
}

function apply(s: GameSnapshot, msg: ServerMessage): GameSnapshot {
  switch (msg.type) {
    case 'action.started':
      return { ...s, runningActions: [...s.runningActions.filter((r) => r.runId !== msg.data.runId), msg.data] };
    case 'action.ended':
      return { ...s, runningActions: s.runningActions.filter((r) => r.runId !== msg.data.runId) };
    case 'king':
      return { ...s, king: msg.data };
    case 'feed':
      return { ...s, feed: msg.data };
    case 'leaderboard':
      return { ...s, leaderboard: msg.data.entries, kgBoard: msg.data.kgBoard, participants: msg.data.participants };
    case 'bigfish.next':
      return { ...s, nextBigFishAt: msg.data.at, bigFishShadowMs: msg.data.shadowMs };
    case 'roster':
      return { ...s, roster: msg.data };
    case 'collective':
      return { ...s, collective: msg.data };
    case 'connectors':
      return { ...s, connectors: msg.data };
    case 'game':
      return { ...s, running: msg.data.running, sessionId: msg.data.sessionId, streamOffline: msg.data.streamOffline };
    case 'queue':
      return { ...s, queueLength: msg.data.length };
    default:
      return s;
  }
}
