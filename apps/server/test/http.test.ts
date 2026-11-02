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

const env = { ADMIN_PASSWORD: 'mat-khau-test', SESSION_SECRET: 'x'.repeat(40), COOKIE_SECURE: false, STATIC_DIR: undefined };

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
      tiktok: new FakeTikTok(),
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
    const res = await req('/api/actions/throw_paper', { method: 'PUT', body: JSON.stringify({ enabled: false, cooldownMs: 1234 }) });
    expect(res.status).toBe(200);
    const saved = store.config!.actions.find((a) => a.id === 'throw_paper')!;
    expect(saved).toMatchObject({ enabled: false, cooldownMs: 1234 });
    expect(service.engine.getConfig().actions.find((a) => a.id === 'throw_paper')!.enabled).toBe(false);
  });

  test('dữ liệu không hợp lệ trả 400', async () => {
    await login();
    expect((await req('/api/actions/throw_paper', { method: 'PUT', body: JSON.stringify({ cooldownMs: -5 }) })).status).toBe(400);
    expect((await req('/api/actions/khong_co', { method: 'PUT', body: JSON.stringify({ enabled: true }) })).status).toBe(404);
    const badGift = [{ giftId: 1, giftName: 'x', actionId: 'khong_co', minCount: 1, enabled: true }];
    expect((await req('/api/gifts', { method: 'PUT', body: JSON.stringify(badGift) })).status).toBe(400);
  });

  test('sửa mapping quà không cần sửa code', async () => {
    await login();
    const gifts = [{ giftId: 7934, giftName: 'Heart Me', actionId: 'lock_toilet', minCount: 1, enabled: true }];
    expect((await req('/api/gifts', { method: 'PUT', body: JSON.stringify(gifts) })).status).toBe(200);
    expect(service.engine.getConfig().gifts).toEqual(gifts);
  });

  test('kích hoạt thử nghiệm, chỉnh Sếp, reset phiên, lịch sử', async () => {
    await login();
    await req('/api/game/start', { method: 'POST' });
    const t = await (await req('/api/actions/flat_tire/trigger', { method: 'POST', body: '{}' })).json();
    expect(t.outcome).toBe('accepted');
    expect(service.engine.snapshot().runningActions[0]!.actionId).toBe('flat_tire');
    expect((await (await req('/api/boss', { method: 'POST', body: JSON.stringify({ calm: 10 }) })).json()).mood).toBe('helpless');
    await service.flush();
    const hist = await (await req('/api/history?limit=10')).json();
    expect(hist[0].actionId).toBe('flat_tire');
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
    expect(cfg.work.map((w: { id: string }) => w.id)).toEqual(['lam_viec', 'nop_bao_cao', 'tang_ca', 'pha_ca_phe', 'xin_nghi', 'hop_nhom']);

    const task = { id: 'viet_code', name: 'Viết code', enabled: true, keywords: ['viet code'], emoji: '💻', text: 'Code chạy rồi!', points: 4, userCooldownMs: 0 };
    const put = (body: unknown) => req('/api/work', { method: 'PUT', body: JSON.stringify(body) });
    const res = await put([task]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([task]);
    expect(store.config!.work).toEqual([task]);
    expect(service.engine.getConfig().work).toEqual([task]);

    await req('/api/game/start', { method: 'POST' });
    const user = { platformId: '9', username: 'nine', displayName: 'Nine' };
    expect(service.engine.ingest({ id: 'w1', source: 'tiktok', kind: 'comment', receivedAt: 0, text: 'viết code', user })).toBe('work');
    expect(service.engine.ingest({ id: 'w2', source: 'tiktok', kind: 'comment', receivedAt: 0, text: 'lam viec', user })).toBe('participated');
    await service.flush();
    const hist = await (await req('/api/history?outcome=work')).json();
    expect(hist.map((h: { summary: string }) => h.summary)).toEqual(['Viết code']);

    for (const bad of [
      [{ ...task, id: 'Viet-Code' }],
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
    expect(store.config!.actions.find((a) => a.id === 'praise_boss')!.trigger.followersOnly).toBeUndefined();
    expect((await put('praise_boss', { followersOnly: true })).status).toBe(200);
    expect(store.config!.actions.find((a) => a.id === 'praise_boss')!.trigger.followersOnly).toBe(true);
    const actions = await (await put('throw_paper', { followersOnly: false })).json();
    expect(actions.find((a: { id: string }) => a.id === 'throw_paper').trigger).toMatchObject({ followersOnly: false, keywords: [], kinds: [] });
    expect(service.engine.getConfig().actions.find((a) => a.id === 'throw_paper')!.trigger.followersOnly).toBe(false);
    expect((await put('throw_paper', { followersOnly: 'yes' })).status).toBe(400);
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
