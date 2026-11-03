import { beforeEach, describe, expect, test } from 'bun:test';
import { defaultGameConfig } from '../src/config/defaults';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import type { ConnectorState } from '../src/connectors/types';
import { ManualClock } from '../src/engine/clock';
import { signSession, verifySession } from '../src/http/auth';
import { createApp } from '../src/http/app';
import { silentLogger } from '../src/logger';
import { GameService, type TikTokControl } from '../src/service';
import { MemoryStore } from '../src/store/memory-store';

class FakeTikTok implements TikTokControl {
  readonly name = 'tiktok';
  st: ConnectorState = { status: 'disconnected', username: null, roomId: null, viewerCount: 0, lastError: null, reconnectAttempt: 0 };
  onEvent() {}
  onState() {}
  state() {
    return this.st;
  }
  async connect(u: string) {
    this.st = { ...this.st, status: 'connected', username: u };
  }
  async disconnect() {
    this.st = { ...this.st, status: 'disconnected' };
  }
}

type JsonResponse = Omit<Response, 'json'> & { json(): Promise<any> };

const env = {
  ADMIN_PASSWORD: 'mat-khau-test',
  SESSION_SECRET: 'x'.repeat(40),
  COOKIE_SECURE: false,
  STATIC_DIR: undefined,
  OVERLAY_KEY: 'khoa-overlay-bi-mat'
};

describe('auth', () => {
  test('token ký đúng / sai / hết hạn', () => {
    const t = signSession('s'.repeat(32), 1000, 500);
    expect(verifySession('s'.repeat(32), t, 1200)).toBe(true);
    expect(verifySession('s'.repeat(32), t, 1600)).toBe(false);
    expect(verifySession('k'.repeat(32), t, 1200)).toBe(false);
    expect(verifySession('s'.repeat(32), t.replace(/.$/, 'A'), 1200)).toBe(false);
    expect(verifySession('s'.repeat(32), 'rác', 1200)).toBe(false);
  });
});

describe('HTTP API', () => {
  let app: ReturnType<typeof createApp>;
  let service: GameService;
  let store: MemoryStore;
  let tiktok: FakeTikTok;
  let cookie = '';

  const req = async (path: string, init: RequestInit = {}): Promise<JsonResponse> =>
    await app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers as Record<string, string>) }
    });

  beforeEach(async () => {
    store = new MemoryStore();
    service = await GameService.create({
      store,
      clock: new ManualClock(),
      logger: silentLogger,
      defaults: defaultGameConfig(),
      tiktok: (tiktok = new FakeTikTok()),
      demo: new DemoConnector(),
      historyRetentionDays: 30
    });
    app = createApp({ service, env, logger: silentLogger });
    cookie = '';
  });

  const login = async () => {
    const res = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }) });
    expect(res.status).toBe(200);
    cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  };

  test('API quản trị bắt buộc đăng nhập', async () => {
    expect((await req('/api/state')).status).toBe(401);
    expect((await req('/api/game/start', { method: 'POST' })).status).toBe(401);
  });

  test('sai mật khẩu bị từ chối, quá nhiều lần thì bị chặn', async () => {
    const bad = () => req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'sai-roi-nhe' }) });
    expect((await bad()).status).toBe(401);
    for (let i = 0; i < 4; i++) await bad();
    expect((await bad()).status).toBe(429);
  });

  test('cookie phiên có HttpOnly + SameSite=Strict', async () => {
    const res = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }) });
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Strict');
  });

  test('request ghi dữ liệu phải là JSON (chống CSRF bằng form)', async () => {
    await login();
    const res = await app.request('/api/game/start', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
  });

  test('bắt đầu game, bật/tắt + chỉnh cooldown hành động, lưu xuống store', async () => {
    await login();
    expect((await (await req('/api/game/start', { method: 'POST' })).json()).running).toBe(true);
    const res = await req('/api/actions/pull_carp', { method: 'PUT', body: JSON.stringify({ enabled: false, cooldownMs: 1234 }) });
    expect(res.status).toBe(200);
    const saved = store.config!.actions.find((a) => a.id === 'pull_carp')!;
    expect(saved).toMatchObject({ enabled: false, cooldownMs: 1234 });
    expect(service.engine.getConfig().actions.find((a) => a.id === 'pull_carp')!.enabled).toBe(false);
  });

  test('dữ liệu không hợp lệ trả 400', async () => {
    await login();
    expect((await req('/api/actions/pull_carp', { method: 'PUT', body: JSON.stringify({ cooldownMs: -5 }) })).status).toBe(400);
    expect((await req('/api/actions/khong_co', { method: 'PUT', body: JSON.stringify({ enabled: true }) })).status).toBe(404);
    const badGift = [{ giftId: 1, giftName: 'x', actionId: 'khong_co', minCount: 1, enabled: true }];
    expect((await req('/api/gifts', { method: 'PUT', body: JSON.stringify(badGift) })).status).toBe(400);
  });

  test('sửa mapping quà không cần sửa code', async () => {
    await login();
    const gifts = [{ giftId: 7934, giftName: 'Heart Me', actionId: 'pull_arowana', minCount: 1, enabled: true }];
    expect((await req('/api/gifts', { method: 'PUT', body: JSON.stringify(gifts) })).status).toBe(200);
    expect(service.engine.getConfig().gifts).toEqual(gifts);
  });

  test('kích hoạt thử nghiệm, chỉnh Cá Thần, reset phiên, lịch sử', async () => {
    await login();
    await req('/api/game/start', { method: 'POST' });
    const t = await (await req('/api/actions/pull_stingray/trigger', { method: 'POST', body: '{}' })).json();
    expect(t.outcome).toBe('accepted');
    expect(service.engine.snapshot().runningActions[0]!).toMatchObject({ actionId: 'pull_stingray', fish: { name: 'Cá đuối khổng lồ' } });
    expect((await (await req('/api/king', { method: 'POST', body: JSON.stringify({ calm: 10 }) })).json()).mood).toBe('exhausted');
    expect((await req('/api/boss', { method: 'POST', body: JSON.stringify({ calm: 10 }) })).status).toBe(404);
    await service.flush();
    const hist = await (await req('/api/history?limit=10')).json();
    expect(hist[0].actionId).toBe('pull_stingray');
    const before = service.engine.currentSessionId;
    const { sessionId } = await (await req('/api/session/reset', { method: 'POST' })).json();
    expect(sessionId).not.toBe(before);
    expect(service.engine.snapshot().runningActions).toHaveLength(0);
  });

  test('bật/tắt demo và kết nối TikTok', async () => {
    await login();
    expect((await (await req('/api/demo/start', { method: 'POST' })).json()).demo.running).toBe(true);
    expect((await (await req('/api/demo/stop', { method: 'POST' })).json()).demo.running).toBe(false);
    const info = await (await req('/api/live/connect', { method: 'POST', body: JSON.stringify({ username: '@abc' }) })).json();
    expect(info.tiktok.status).toBe('connected');
  });

  test('công việc: GET /config có work, PUT /work validate + lưu + áp dụng ngay', async () => {
    await login();
    const cfg = await (await req('/api/config')).json();
    expect(cfg.work.map((w: { id: string }) => w.id)).toEqual(['thay_moi', 'uong_tra', 'khoe_ca', 'hat_ho', 'ngu_gat']);
    expect(cfg.fishing).toMatchObject({ tickMs: 5000, catchesPerTick: 1, bigFishEveryMs: 180_000, bigFishShadowMs: 15_000, frontSeats: 5 });
    expect(cfg.king).toBeDefined();

    const task = { id: 'go_phao', name: 'Gõ phao', enabled: true, keywords: ['go phao'], emoji: '🎈', text: 'Phao nhúc nhích!', points: 4, userCooldownMs: 0 };
    const put = (body: unknown) => req('/api/work', { method: 'PUT', body: JSON.stringify(body) });
    const res = await put([task]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([task]);
    expect(store.config!.work).toEqual([task]);
    expect(service.engine.getConfig().work).toEqual([task]);

    await req('/api/game/start', { method: 'POST' });
    const user = { platformId: '9', username: 'nine', displayName: 'Nine' };
    expect(service.engine.ingest({ id: 'w1', source: 'tiktok', kind: 'comment', receivedAt: 0, text: 'gõ phao', user })).toBe('work');
    expect(service.engine.ingest({ id: 'w2', source: 'tiktok', kind: 'comment', receivedAt: 0, text: 'thay moi', user })).toBe('participated');
    await service.flush();
    const hist = await (await req('/api/history?outcome=work')).json();
    expect(hist.map((h: { summary: string }) => h.summary)).toEqual(['Gõ phao']);

    for (const bad of [
      [{ ...task, id: 'Go-Phao' }],
      [{ ...task, points: -1 }],
      [{ ...task, emoji: '' }],
      [{ ...task, text: 'x'.repeat(81) }],
      [{ ...task, userCooldownMs: 600_001 }],
      [{ ...task, keywords: ['x'.repeat(41)] }],
      [task, task], // trùng id
      Array.from({ length: 51 }, (_, i) => ({ ...task, id: `t${i}` })),
      { ...task }
    ]) {
      expect((await put(bad)).status).toBe(400);
    }
    expect(store.config!.work).toEqual([task]);
  });

  test('bật/tắt followersOnly cho hành động', async () => {
    await login();
    const put = (id: string, body: unknown) => req(`/api/actions/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    expect(store.config!.actions.find((a) => a.id === 'pull_koi')!.trigger.followersOnly).toBeUndefined();
    expect((await put('pull_koi', { followersOnly: true })).status).toBe(200);
    expect(store.config!.actions.find((a) => a.id === 'pull_koi')!.trigger.followersOnly).toBe(true);
    const actions = await (await put('pull_carp', { followersOnly: false })).json();
    expect(actions.find((a: { id: string }) => a.id === 'pull_carp').trigger).toMatchObject({ followersOnly: false, keywords: [], kinds: [] });
    expect(service.engine.getConfig().actions.find((a) => a.id === 'pull_carp')!.trigger.followersOnly).toBe(false);
    expect((await put('pull_carp', { followersOnly: 'yes' })).status).toBe(400);
  });

  test('câu tự động: GET/PUT /fishing validate + lưu + áp dụng ngay', async () => {
    await login();
    expect((await (await req('/api/fishing')).json()).tickMs).toBe(5000);
    const put = (body: unknown) => req('/api/fishing', { method: 'PUT', body: JSON.stringify(body) });
    const res = await put({ tickMs: 3000, catchesPerTick: 2, frontSeats: 3, bigFishShadowMs: 10_000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ tickMs: 3000, catchesPerTick: 2, frontSeats: 3, bigFishShadowMs: 10_000, bigFishEveryMs: 180_000 });
    expect(store.config!.fishing.tickMs).toBe(3000);
    expect(service.engine.getConfig().fishing.catchesPerTick).toBe(2);
    expect((await (await req('/api/config')).json()).fishing.frontSeats).toBe(3);
    expect(service.engine.snapshot().bigFishShadowMs).toBe(10_000);
    for (const bad of [
      { tickMs: 10 },
      { catchesPerTick: 0 },
      { loot: [] },
      { bigFishActionId: 'khong_co' },
      { loot: [{ emoji: '🐟', name: 'x', weight: 1, minKg: 5, maxKg: 1, points: 0 }] },
      { loot: [{ emoji: '🐟', name: 'x', weight: 0, minKg: 0, maxKg: 1, points: 0 }] }
    ]) {
      expect((await put(bad)).status).toBe(400);
    }
    expect(store.config!.fishing.tickMs).toBe(3000);
  });

  test('sửa cá của hành động (fish, null = bỏ) và tác động Cá Thần', async () => {
    await login();
    const put = (body: unknown) => req('/api/actions/pull_carp', { method: 'PUT', body: JSON.stringify(body) });
    const fish = { emoji: '🐟', name: 'Cá chép đỏ', minKg: 4, maxKg: 8 };
    expect((await put({ fish, kingCalm: -9, kingStamina: -1 })).status).toBe(200);
    expect(store.config!.actions.find((a) => a.id === 'pull_carp')).toMatchObject({ fish, kingEffect: { calm: -9, stamina: -1 } });
    expect((await put({ fish: null })).status).toBe(200);
    expect(store.config!.actions.find((a) => a.id === 'pull_carp')!.fish).toBeUndefined();
    expect((await put({ fish: { ...fish, name: '' } })).status).toBe(400);
  });

  test('bảng cân cá qua /leaderboard?board=kg', async () => {
    await login();
    await req('/api/game/start', { method: 'POST' });
    const user = { platformId: '7', username: 'bay', displayName: 'Bảy' };
    service.engine.ingest({ id: 'g1', source: 'tiktok', kind: 'gift', receivedAt: 0, user, gift: { giftId: 1, name: 'Rose', count: 1, diamonds: 1 } });
    const kg = await (await req('/api/leaderboard?board=kg')).json();
    expect(kg[0].platformId).toBe('7');
    expect(kg[0].kg).toBeGreaterThanOrEqual(3);
  });

  test('demo bị từ chối (409) khi đang kết nối TikTok; kết nối TikTok thì tắt demo trước', async () => {
    await login();
    expect((await (await req('/api/demo/start', { method: 'POST' })).json()).demo.running).toBe(true);
    const info = await (await req('/api/live/connect', { method: 'POST', body: JSON.stringify({ username: '@abc' }) })).json();
    expect(info.tiktok.status).toBe('connected');
    expect(info.demo.running).toBe(false); // demo tự tắt
    const res = await req('/api/demo/start', { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('TikTok');
    expect(service.connectorInfo().demo.running).toBe(false);
    for (const status of ['connecting', 'reconnecting'] as const) {
      tiktok.st = { ...tiktok.st, status };
      expect((await req('/api/demo/start', { method: 'POST' })).status).toBe(409);
    }
    await req('/api/live/disconnect', { method: 'POST' });
    expect((await (await req('/api/demo/start', { method: 'POST' })).json()).demo.running).toBe(true);
    await req('/api/demo/stop', { method: 'POST' });
  });

  test('healthz', async () => {
    const res: JsonResponse = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect((await res.json()).db).toBe(true);
  });
});

describe('DemoConnector', () => {
  test('sự kiện demo luôn có source=demo và user demo:*', () => {
    let x = 0;
    const d = new DemoConnector(1000, () => ((x = (x * 9301 + 49297) % 233280) / 233280));
    for (let i = 0; i < 200; i++) {
      const e = d.next(i);
      expect(e.source).toBe('demo');
      expect(e.user.platformId.startsWith('demo:')).toBe(true);
      expect(e.id.startsWith('demo:')).toBe(true);
    }
  });

  test('người chơi demo không được lưu xuống DB', async () => {
    const store = new MemoryStore();
    const service = await GameService.create({
      store,
      clock: new ManualClock(),
      logger: silentLogger,
      defaults: defaultGameConfig(),
      tiktok: new FakeTikTok(),
      historyRetentionDays: 30
    });
    await service.startGame();
    service.engine.ingest(new DemoConnector().next());
    service.engine.ingest({
      id: 'tt:1',
      source: 'tiktok',
      kind: 'comment',
      receivedAt: 0,
      text: 'hi',
      user: { platformId: '42', username: 'real', displayName: 'Real' }
    });
    await service.flush();
    expect([...store.players.keys()]).toEqual(['42']);
  });
});
