import { readCookie, safeEqual, SESSION_COOKIE, verifySession } from './http/auth';
import { createApp } from './http/app';
import { defaultGameConfig } from './config/defaults';
import { loadEnv } from './config/env';
import { TikTokConnector } from './connectors/tiktok/tiktok-connector';
import { systemClock } from './engine/clock';
import { createLogger } from './logger';
import { GameService } from './service';
import { MemoryStore } from './store/memory-store';
import { PgStore } from './store/pg-store';
import { WsHub, type WsData } from './ws/hub';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const log = logger.child('main');

const store = env.STORE === 'postgres' ? new PgStore(env.DATABASE_URL!) : new MemoryStore();
if (env.STORE === 'memory') log.warn('STORE=memory: dữ liệu sẽ mất khi tắt server');

const tiktok = new TikTokConnector({ logger, signApiKey: env.TIKTOK_SIGN_API_KEY });

const service = await GameService.create({
  store,
  clock: systemClock,
  logger,
  defaults: defaultGameConfig(),
  tiktok,
  historyRetentionDays: env.HISTORY_RETENTION_DAYS
});

const hub = new WsHub(() => service.engine.snapshot());
service.subscribe((msg) => hub.broadcast(msg));
service.startLoops();

const app = createApp({ service, env, logger });

const server = Bun.serve<WsData>({
  hostname: env.HOST,
  port: env.PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws/overlay') {
      const key = url.searchParams.get('key') ?? '';
      if (!safeEqual(key, env.OVERLAY_KEY)) return new Response('Sai overlay key', { status: 401 });
      return srv.upgrade(req, { data: { channel: 'overlay' } }) ? undefined : new Response('Upgrade failed', { status: 400 });
    }
    if (url.pathname === '/ws/admin') {
      if (!verifySession(env.SESSION_SECRET, readCookie(req.headers.get('cookie'), SESSION_COOKIE))) {
        return new Response('Chưa đăng nhập', { status: 401 });
      }
      return srv.upgrade(req, { data: { channel: 'admin' } }) ? undefined : new Response('Upgrade failed', { status: 400 });
    }
    return app.fetch(req, srv);
  },
  websocket: {
    open: (ws) => hub.open(ws),
    close: (ws) => hub.close(ws),
    message: () => {
      // Client không gửi lệnh qua WS; mọi lệnh đi qua REST có xác thực.
    },
    idleTimeout: 120,
    sendPings: true
  }
});

log.info('Server đã chạy', {
  url: `http://${env.HOST}:${server.port}`,
  overlay: `/overlay/?key=<OVERLAY_KEY>`,
  admin: '/admin/'
});

if (env.TIKTOK_USERNAME) {
  service.connectTikTok(env.TIKTOK_USERNAME).catch((err) => log.warn('Tự kết nối TikTok chưa được', { err }));
}

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info('Đang tắt server', { signal });
  server.stop();
  await service.shutdown().catch((err) => log.error('Lỗi khi tắt', { err }));
  process.exit(0);
};
// Chạy 24/7: một promise bị từ chối / lỗi lạc trong callback thư viện (TikTok, DB) không được làm sập server
// (mất người đang ngồi trong hồ, hàng đợi, thống kê phiên chỉ có trong bộ nhớ). Ghi log rồi chạy tiếp.
process.on('unhandledRejection', (reason) => log.error('Promise bị từ chối không được xử lý', { err: reason }));
process.on('uncaughtException', (err) => log.error('Lỗi không được bắt', { err }));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
