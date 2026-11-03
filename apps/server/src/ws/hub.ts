import type { ServerWebSocket } from 'bun';
import type { GameSnapshot, ServerMessage } from '@cau/shared';

export type Channel = 'overlay' | 'admin';
export interface WsData {
  channel: Channel;
}

/** Tin nhắn chỉ dành cho admin (overlay không cần, và không nên lộ ra). */
const ADMIN_ONLY: ReadonlySet<ServerMessage['type']> = new Set(['history', 'queue']);

/**
 * WebSocket hub: kênh overlay (chỉ đọc, xác thực bằng OVERLAY_KEY) và kênh admin (cookie phiên).
 * Client không gửi lệnh qua WS — mọi lệnh đi qua REST API có xác thực.
 */
export class WsHub {
  private clients = new Set<ServerWebSocket<WsData>>();

  constructor(private snapshot: () => GameSnapshot) {}

  open(ws: ServerWebSocket<WsData>): void {
    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', data: this.snapshot() } satisfies ServerMessage));
  }

  close(ws: ServerWebSocket<WsData>): void {
    this.clients.delete(ws);
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    const adminOnly = ADMIN_ONLY.has(msg.type);
    for (const ws of this.clients) {
      if (adminOnly && ws.data.channel !== 'admin') continue;
      // Client quá chậm (đệm > 1MB) thì bỏ qua tin này thay vì làm phình bộ nhớ.
      if (ws.getBufferedAmount() > 1_000_000) continue;
      ws.send(payload);
    }
  }

  counts(): Record<Channel, number> {
    let overlay = 0;
    let admin = 0;
    for (const ws of this.clients) ws.data.channel === 'admin' ? admin++ : overlay++;
    return { overlay, admin };
  }
}
