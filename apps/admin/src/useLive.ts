import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot, HistoryEntry, ServerMessage } from '@sep/shared';

/** Trạng thái realtime qua /ws/admin (xác thực bằng cookie phiên). */
export function useLive(enabled: boolean) {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/admin`);
      ws.onopen = () => {
        retry.current = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry.current += 1;
        timer = setTimeout(open, Math.min(10_000, 500 * 2 ** retry.current));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        if (msg.type === 'snapshot') return setSnap(msg.data);
        if (msg.type === 'history') return setHistory((h) => [msg.data, ...h].slice(0, 200));
        setSnap((s) => (s ? apply(s, msg) : s));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [enabled]);

  return { snap, history, connected };
}

function apply(s: GameSnapshot, msg: ServerMessage): GameSnapshot {
  switch (msg.type) {
    case 'action.started':
      return { ...s, runningActions: [...s.runningActions.filter((r) => r.runId !== msg.data.runId), msg.data] };
    case 'action.ended':
      return { ...s, runningActions: s.runningActions.filter((r) => r.runId !== msg.data.runId) };
    case 'boss':
      return { ...s, boss: msg.data };
    case 'feed':
      return { ...s, feed: msg.data };
    case 'leaderboard':
      return { ...s, leaderboard: msg.data.entries, participants: msg.data.participants };
    case 'roster':
      return { ...s, roster: msg.data };
    case 'collective':
      return { ...s, collective: msg.data };
    case 'connectors':
      return { ...s, connectors: msg.data };
    case 'game':
      return { ...s, running: msg.data.running, sessionId: msg.data.sessionId };
    case 'queue':
      return { ...s, queueLength: msg.data.length };
    default:
      return s;
  }
}
