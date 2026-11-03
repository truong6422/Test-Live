import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { GameConfig, LakeState, NormalizedEvent, SessionStats } from '@cau/shared';
import { defaultGameConfig, reconcileConfig } from '../src/config/defaults';
import { DemoConnector } from '../src/connectors/demo/demo-connector';
import type { ConnectorState } from '../src/connectors/types';
import { ManualClock } from '../src/engine/clock';
import { KICK_REJOIN_BLOCK_MS } from '../src/engine/engine';
import { createApp } from '../src/http/app';
import { silentLogger } from '../src/logger';
import { cleanComment, DEFAULT_BLOCKLIST, setBlocklist } from '../src/normalizer/sanitize';
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
  SESSION_SECRET: 'y'.repeat(40),
  COOKIE_SECURE: false,
  STATIC_DIR: undefined,
  OVERLAY_KEY: 'khoa-overlay-bi-mat-123'
};

let seq = 0;
const comment = (id: string, text = 'chào'): NormalizedEvent => ({
  id: `c${++seq}`,
  source: 'tiktok',
  kind: 'comment',
  receivedAt: 0,
  text,
  user: { platformId: id, username: id, displayName: `Cần thủ ${id}` }
});
const gift = (id: string, diamonds: number): NormalizedEvent => ({
  id: `g${++seq}`,
  source: 'tiktok',
  kind: 'gift',
  receivedAt: 0,
  gift: { giftId: 9999, name: 'Quà', count: 1, diamonds },
  user: { platformId: id, username: id, displayName: `Cần thủ ${id}` }
});

describe('API quản trị hồ câu / overlay / thống kê / bộ lọc từ', () => {
  let app: ReturnType<typeof createApp>;
  let service: GameService;
  let store: MemoryStore;
  let clock: ManualClock;
  let cookie = '';

  const req = async (path: string, init: RequestInit = {}): Promise<JsonResponse> =>
    await app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers as Record<string, string>) }
    });
  const post = (path: string, body: unknown = {}) => req(path, { method: 'POST', body: JSON.stringify(body) });

  const login = async () => {
    const res = await post('/api/auth/login', { password: env.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  };

  beforeEach(async () => {
    store = new MemoryStore();
    clock = new ManualClock();
    service = await GameService.create({
      store,
      clock,
      logger: silentLogger,
      defaults: defaultGameConfig(),
      tiktok: new FakeTikTok(),
      demo: new DemoConnector(),
      historyRetentionDays: 30
    });
    app = createApp({ service, env, logger: silentLogger });
    cookie = '';
  });

  afterAll(() => setBlocklist(DEFAULT_BLOCKLIST));

  test('các endpoint mới đều bắt buộc đăng nhập', async () => {
    for (const [method, path] of [
      ['GET', '/api/overlay-url'],
      ['GET', '/api/lake'],
      ['POST', '/api/lake/kick'],
      ['POST', '/api/bigfish/now'],
      ['GET', '/api/stats'],
      ['GET', '/api/blocklist'],
      ['PUT', '/api/blocklist'],
      ['POST', '/api/blocklist/test']
    ] as const) {
      const res = await req(path, { method, body: method === 'GET' ? undefined : '{}' });
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain(env.OVERLAY_KEY);
    }
  });

  test('GET /api/overlay-url trả đường dẫn có key (không cache); key không lộ ở state / config', async () => {
    await login();
    const res = await req('/api/overlay-url');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ path: `/overlay/?key=${env.OVERLAY_KEY}` });
    expect(await (await req('/api/state')).text()).not.toContain(env.OVERLAY_KEY);
    expect(await (await req('/api/config')).text()).not.toContain(env.OVERLAY_KEY);
  });

  test('GET /api/lake: người đang ngồi + người tới lượt kế tiếp', async () => {
    await login();
    await service.startGame();
    for (const id of ['a', 'b', 'c']) service.engine.ingest(comment(id));
    let lake: LakeState = await (await req('/api/lake')).json();
    expect(lake.roster.map((m) => m.platformId).sort()).toEqual(['a', 'b', 'c']);
    expect(lake.capacity).toBe(50);
    expect(lake.nextTurnId).toBe('a');
    // Một chu kỳ câu: a được cá → tới lượt b.
    clock.advance(5000);
    service.engine.tick();
    lake = await (await req('/api/lake')).json();
    expect(lake.nextTurnId).toBe('b');
  });

  test('POST /api/lake/kick: mời rời hồ, không tự vào lại bằng bình luận (quà vẫn vào)', async () => {
    await login();
    await service.startGame();
    for (const id of ['a', 'b']) service.engine.ingest(comment(id));

    const res = await post('/api/lake/kick', { platformId: 'b' });
    expect(res.status).toBe(200);
    expect((await res.json()).roster.map((m: { platformId: string }) => m.platformId)).toEqual(['a']);
    expect((await post('/api/lake/kick', { platformId: 'b' })).status).toBe(404);
    expect((await post('/api/lake/kick', {})).status).toBe(400);

    // Bình luận lại ngay → vẫn ngoài hồ.
    service.engine.ingest(comment('b'));
    expect(service.engine.lakeState().roster.some((m) => m.platformId === 'b')).toBe(false);
    // Hết thời gian chặn → bình luận là vào lại.
    clock.advance(KICK_REJOIN_BLOCK_MS + 1);
    service.engine.ingest(comment('a')); // a vẫn hoạt động (không bị idle kick)
    service.engine.ingest(comment('b'));
    expect(service.engine.lakeState().roster.some((m) => m.platformId === 'b')).toBe(true);

    // Bị mời ra rồi tặng quà → vào lại ngay.
    await post('/api/lake/kick', { platformId: 'b' });
    service.engine.ingest(gift('b', 1));
    expect(service.engine.lakeState().roster.some((m) => m.platformId === 'b')).toBe(true);

    await service.flush();
    const hist = await (await req('/api/history?limit=50')).json();
    expect(hist.some((h: { summary: string; playerId: string }) => h.summary === 'Admin mời rời hồ' && h.playerId === 'b')).toBe(true);
  });

  test('POST /api/bigfish/now: game dừng / hồ trống → 409; có người → chạy cá to và hẹn chu kỳ mới', async () => {
    await login();
    expect((await post('/api/bigfish/now')).status).toBe(409);
    await service.startGame();
    expect((await post('/api/bigfish/now')).status).toBe(409);

    service.engine.ingest(comment('a'));
    const res = await post('/api/bigfish/now');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('started');
    expect(body.nextBigFishAt).toBe(clock.now() + defaultGameConfig().fishing.bigFishEveryMs);
    const run = service.engine.snapshot().runningActions[0]!;
    expect(run.actionId).toBe('big_fish_event');
    expect(run.actor?.displayName).toBe('Cần thủ a');

    // Đang kéo cá → lần bấm tiếp theo bị hoãn tới ngay sau khi xong.
    const again = await (await post('/api/bigfish/now')).json();
    expect(again.result).toBe('postponed');
    expect(again.nextBigFishAt).toBeGreaterThan(clock.now());

    // Hành động cá to định kỳ đang tắt → 409.
    await req('/api/actions/big_fish_event', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    expect((await post('/api/bigfish/now')).status).toBe(409);
  });

  test('GET /api/stats: cá, kg, quà, con to nhất; reset phiên về 0', async () => {
    await login();
    await service.startGame();
    service.engine.ingest(comment('a'));
    service.engine.ingest(comment('b'));
    for (let i = 0; i < 4; i++) {
      clock.advance(5000);
      service.engine.tick();
    }
    service.engine.ingest(gift('b', 600)); // bậc cao nhất → Cá Thần huyền thoại 150–300 kg
    const s: SessionStats = await (await req('/api/stats')).json();
    expect(s.fishCaught + s.junkCaught).toBe(5); // 4 cá thường + 1 cá to
    expect(s.bigFishPulled).toBe(1);
    expect(s.giftsReceived).toBe(1);
    expect(s.giftDiamonds).toBe(600);
    expect(s.activeMs).toBeGreaterThanOrEqual(20_000);
    expect(s.biggest).toMatchObject({ displayName: 'Cần thủ b', name: 'Cá Thần huyền thoại' });
    expect(s.biggest!.kg).toBeGreaterThanOrEqual(150);
    expect(s.totalKg).toBeGreaterThanOrEqual(s.biggest!.kg);
    expect(s.queueLength).toBe(service.engine.snapshot().queueLength);

    await post('/api/session/reset');
    const z: SessionStats = await (await req('/api/stats')).json();
    expect(z).toMatchObject({ fishCaught: 0, junkCaught: 0, bigFishPulled: 0, totalKg: 0, giftsReceived: 0, giftDiamonds: 0, biggest: null });
  });

  test('bộ lọc từ: GET mặc định, PUT chuẩn hoá + lưu + áp dụng ngay, thử nghiệm, validate', async () => {
    await login();
    const initial = await (await req('/api/blocklist')).json();
    expect(initial).toEqual([...DEFAULT_BLOCKLIST]);
    expect(cleanComment('cá to vcl')).toBe('cá to ***');

    const res = await req('/api/blocklist', { method: 'PUT', body: JSON.stringify(['Xấu!!', 'xấu', 'bậy', ' tệ ']) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(['xấu', 'bậy', 'tệ']);
    expect(store.config!.blocklist).toEqual(['xấu', 'bậy', 'tệ']);
    expect((await (await req('/api/config')).json()).blocklist).toEqual(['xấu', 'bậy', 'tệ']);
    // Normalizer dùng danh sách mới ngay: "vcl" không còn trong danh sách.
    expect(cleanComment('cá XẤU vcl')).toBe('cá *** vcl');

    // Thử với danh sách đang lưu và danh sách nháp.
    const t1 = await (await post('/api/blocklist/test', { text: 'đồ bậy bạ' })).json();
    expect(t1.comment).toBe('đồ *** bạ');
    const t2 = await (await post('/api/blocklist/test', { text: 'đồ bậy bạ', words: ['bạ'] })).json();
    expect(t2).toEqual({ comment: 'đồ bậy ***', displayName: 'đồ bậy ***' });
    expect(store.config!.blocklist).toEqual(['xấu', 'bậy', 'tệ']); // thử không lưu

    for (const bad of [['hai từ'], [''], ['x'.repeat(41)], 'xấu', Array.from({ length: 1001 }, (_, i) => `w${i}`)]) {
      expect((await req('/api/blocklist', { method: 'PUT', body: JSON.stringify(bad) })).status).toBe(400);
    }
    expect((await post('/api/blocklist/test', { text: 'x'.repeat(501) })).status).toBe(400);
  });

  test('cấu hình cũ chưa có blocklist → nâng cấp điền danh sách mặc định', async () => {
    const { blocklist: _drop, ...old } = defaultGameConfig();
    const r = reconcileConfig(old as GameConfig, defaultGameConfig());
    expect(r.changed).toBe(true);
    expect(r.config.blocklist).toEqual([...DEFAULT_BLOCKLIST]);

    // Danh sách admin đã sửa (kể cả rỗng) được giữ nguyên.
    const kept = reconcileConfig({ ...defaultGameConfig(), blocklist: [] }, defaultGameConfig());
    expect(kept.config.blocklist).toEqual([]);

    const s = new MemoryStore();
    s.config = old as GameConfig;
    await s.init(defaultGameConfig());
    expect((await s.loadConfig()).blocklist).toEqual([...DEFAULT_BLOCKLIST]);
  });
});
