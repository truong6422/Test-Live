import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { serveStatic } from 'hono/bun';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import path from 'node:path';
import { z } from 'zod';
import {
  actionUpdateSchema,
  blocklistSchema,
  blocklistTestSchema,
  collectiveUpdateSchema,
  fishingUpdateSchema,
  giftMappingsSchema,
  liveConnectSchema,
  kingAdjustSchema,
  lakeKickSchema,
  loginSchema,
  manualTriggerSchema,
  workTasksSchema
} from '@cau/shared';
import type { Env } from '../config/env';
import { DEMO_PROFILES } from '../connectors/demo/demo-connector';
import { UnknownActionError } from '../engine/engine';
import { TokenBucket } from '../engine/rate-limit';
import type { Logger } from '../logger';
import { ConflictError, NotFoundError, ValidationError, type GameService } from '../service';
import { safeEqual, SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from './auth';

export interface AppDeps {
  service: GameService;
  env: Pick<Env, 'ADMIN_PASSWORD' | 'SESSION_SECRET' | 'COOKIE_SECURE' | 'STATIC_DIR' | 'OVERLAY_KEY'>;
  logger: Logger;
}

export function createApp({ service, env, logger }: AppDeps): Hono {
  const app = new Hono();
  const log = logger.child('http');
  const loginBuckets = new Map<string, TokenBucket>();

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    // Không để lộ OVERLAY_KEY trong URL qua Referer.
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
    if (err instanceof UnknownActionError) return c.json({ error: err.message }, 404);
    if (err instanceof z.ZodError) return c.json({ error: 'Dữ liệu không hợp lệ', issues: err.issues }, 400);
    // Body không phải JSON hợp lệ (c.req.json / JSON.parse) → 400, không phải 500.
    if (err instanceof SyntaxError) return c.json({ error: 'JSON không hợp lệ' }, 400);
    log.error('Lỗi xử lý request', { err, path: c.req.path });
    // Không trả chi tiết lỗi nội bộ (chuỗi kết nối DB, đường dẫn…) ra client; chi tiết đã nằm trong log.
    return c.json({ error: 'Lỗi máy chủ' }, 500);
  });

  // --------------------------------------------------------------------------
  // Health check (Docker / Nginx)
  // --------------------------------------------------------------------------
  app.get('/healthz', async (c) => {
    const h = await service.health();
    return c.json(h, h.ok ? 200 : 503);
  });

  // --------------------------------------------------------------------------
  // Xác thực admin
  // --------------------------------------------------------------------------
  app.post('/api/auth/login', async (c) => {
    const ip = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    let bucket = loginBuckets.get(ip);
    if (!bucket) {
      bucket = new TokenBucket(5, 5 / 60, Date.now()); // 5 lần / phút / IP
      loginBuckets.set(ip, bucket);
      if (loginBuckets.size > 1000) loginBuckets.delete(loginBuckets.keys().next().value as string);
    }
    if (!bucket.take(Date.now())) return c.json({ error: 'Thử lại sau ít phút' }, 429);

    const { password } = loginSchema.parse(await c.req.json());
    if (!safeEqual(password, env.ADMIN_PASSWORD)) {
      log.warn('Đăng nhập sai', { ip });
      return c.json({ error: 'Sai mật khẩu' }, 401);
    }
    setCookie(c, SESSION_COOKIE, signSession(env.SESSION_SECRET), {
      httpOnly: true,
      sameSite: 'Strict',
      secure: env.COOKIE_SECURE,
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000)
    });
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    if (!verifySession(env.SESSION_SECRET, getCookie(c, SESSION_COOKIE))) {
      return c.json({ error: 'Chưa đăng nhập' }, 401);
    }
    // Chống CSRF: request thay đổi dữ liệu phải là JSON (form HTML ngoài site không gửi được).
    if (c.req.method !== 'GET' && !c.req.header('content-type')?.includes('application/json')) {
      return c.json({ error: 'Content-Type phải là application/json' }, 415);
    }
    await next();
  };

  const api = new Hono();
  api.use('*', requireAdmin);

  api.get('/auth/me', (c) => c.json({ ok: true }));

  api.get('/state', (c) => c.json(service.engine.snapshot()));
  api.get('/config', (c) => c.json(service.getConfig()));

  // Game & phiên
  api.post('/game/start', async (c) => {
    await service.startGame();
    return c.json(service.engine.snapshot());
  });
  api.post('/game/stop', (c) => {
    service.stopGame();
    return c.json(service.engine.snapshot());
  });
  api.post('/session/reset', async (c) => {
    const sessionId = await service.resetSession();
    return c.json({ sessionId });
  });

  // Kết nối
  api.post('/live/connect', async (c) => {
    const { username } = liveConnectSchema.parse(await c.req.json());
    await service.connectTikTok(username);
    return c.json(service.connectorInfo());
  });
  api.post('/live/disconnect', async (c) => {
    await service.disconnectTikTok();
    return c.json(service.connectorInfo());
  });
  api.post('/demo/start', async (c) => {
    // body tuỳ chọn { profile: 'live' } = giả lập giống phiên LIVE thật; mặc định 'busy' (dồn dập để thử hoạt ảnh)
    // Body rỗng = mặc định; profile lạ → 400 (không âm thầm chạy profile khác với admin chọn).
    const { profile } = z.object({ profile: z.enum(DEMO_PROFILES).optional() }).parse(await readJson(c));
    service.setDemo(true, profile ?? 'busy');
    return c.json(service.connectorInfo());
  });
  api.post('/demo/stop', (c) => {
    service.setDemo(false);
    return c.json(service.connectorInfo());
  });

  // Hành động
  api.put('/actions/:id', async (c) => {
    await service.updateAction(c.req.param('id'), actionUpdateSchema.parse(await c.req.json()));
    return c.json(service.getConfig().actions);
  });
  api.post('/actions/:id/trigger', async (c) => {
    const body = manualTriggerSchema.parse(await readJson(c));
    const outcome = service.engine.triggerManual(c.req.param('id'), body.displayName);
    return c.json({ outcome });
  });

  // Mapping quà
  api.put('/gifts', async (c) => {
    await service.updateGifts(giftMappingsSchema.parse(await c.req.json()));
    return c.json(service.getConfig().gifts);
  });

  // Câu tự động (chu kỳ, bảng cá, cá to định kỳ, ghế Bến Vàng, rời hồ)
  api.get('/fishing', (c) => c.json(service.getConfig().fishing));
  api.put('/fishing', async (c) => {
    await service.updateFishing(fishingUpdateSchema.parse(await c.req.json()));
    return c.json(service.getConfig().fishing);
  });

  // Việc vui bằng bình luận (tương tác miễn phí)
  api.put('/work', async (c) => {
    await service.updateWork(workTasksSchema.parse(await c.req.json()));
    return c.json(service.getConfig().work);
  });

  // Sự kiện tập thể
  api.put('/collective', async (c) => {
    await service.updateCollective(collectiveUpdateSchema.parse(await c.req.json()));
    return c.json(service.getConfig().collective);
  });

  // Cá Thần
  api.post('/king', async (c) => {
    const { calm } = kingAdjustSchema.parse(await c.req.json());
    service.engine.setKingCalm(calm);
    return c.json(service.engine.snapshot().king);
  });

  // Overlay: đường dẫn có OVERLAY_KEY cho khung xem trước / OBS — CHỈ trả cho admin đã đăng nhập.
  api.get('/overlay-url', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ path: `/overlay/?key=${encodeURIComponent(env.OVERLAY_KEY)}` });
  });

  // Hồ câu: người đang ngồi, mời rời hồ, gọi cá to ngay
  api.get('/lake', (c) => c.json(service.engine.lakeState()));
  api.post('/lake/kick', async (c) => {
    const { platformId } = lakeKickSchema.parse(await c.req.json());
    service.kickFromLake(platformId);
    return c.json(service.engine.lakeState());
  });
  api.post('/bigfish/now', (c) => {
    const result = service.bigFishNow();
    return c.json({ result, nextBigFishAt: service.engine.snapshot().nextBigFishAt });
  });

  // Thống kê phiên
  api.get('/stats', (c) => c.json(service.engine.sessionStats()));

  // Bộ lọc từ (che từ tục trong tên / bình luận)
  api.get('/blocklist', (c) => c.json(service.getConfig().blocklist));
  api.put('/blocklist', async (c) => c.json(await service.updateBlocklist(blocklistSchema.parse(await c.req.json()))));
  api.post('/blocklist/test', async (c) => {
    const { text, words } = blocklistTestSchema.parse(await c.req.json());
    return c.json(service.testBlocklist(text, words));
  });

  // Lịch sử & bảng xếp hạng
  api.get('/history', async (c) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        outcome: z
          .enum(['accepted', 'participated', 'deduped', 'rate_limited', 'cooldown', 'disabled', 'dropped', 'expired', 'game_stopped', 'filtered', 'work'])
          .optional(),
        session: z.enum(['current', 'all']).default('current')
      })
      .parse(c.req.query());
    const sessionId = q.session === 'current' ? (service.engine.currentSessionId ?? undefined) : undefined;
    return c.json(await service.listHistory({ limit: q.limit, outcome: q.outcome, sessionId }));
  });
  // TOP QUÀ TẶNG (mặc định) hoặc BẢNG CÂN CÁ (?board=kg); ?scope=total cho toàn thời gian.
  api.get('/leaderboard', (c) => {
    const scope = c.req.query('scope') === 'total' ? 'total' : 'session';
    const players = service.engine.players;
    return c.json(c.req.query('board') === 'kg' ? players.kgBoard(scope, 50) : players.leaderboard(scope, 50));
  });

  app.route('/api', api);

  // --------------------------------------------------------------------------
  // File tĩnh: bản build của overlay và admin
  // --------------------------------------------------------------------------
  // Docker: STATIC_DIR/{overlay,admin}. Máy dev: apps/{overlay,admin}/dist.
  for (const name of ['overlay', 'admin'] as const) {
    const dir = env.STATIC_DIR
      ? path.join(env.STATIC_DIR, name)
      : path.join(import.meta.dir, '..', '..', '..', name, 'dist');
    const root = path.relative(process.cwd(), dir) || '.';
    const strip = (p: string) => p.replace(new RegExp(`^/${name}`), '') || '/';
    app.get(`/${name}`, (c) => c.redirect(`/${name}/${new URL(c.req.url).search}`));
    app.use(`/${name}/*`, serveStatic({ root, rewriteRequestPath: strip }));
    // SPA fallback
    app.get(`/${name}/*`, serveStatic({ root, path: 'index.html' }));
  }
  app.get('/', (c) => c.redirect('/admin/'));

  return app;
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  return text ? JSON.parse(text) : {};
}
