import { useState } from 'react';
import type { ActionConfig, GameConfig, Lane } from '@cau/shared';
import { api, type ActionPatch } from '../api';
import type { Run } from '../App';
import { FishThumb } from '../components/FishSprite';

const LANE_LABELS: Record<Lane, string> = {
  king: 'Cá Thần',
  lake: 'Mặt hồ',
  dock: 'Bến câu',
  sky: 'Bầu trời',
  underwater: 'Đáy hồ',
  anglers: 'Cần thủ'
};

export function ActionsPage({ config, run, reloadConfig }: { config: GameConfig; run: Run; reloadConfig: () => Promise<void> }) {
  return (
    <div className="stack">
      <h1>Hành động</h1>
      <p className="muted">
        <b>Kéo cá to bằng quà tặng</b>: mỗi hành động được kích hoạt theo giá trị quà (kim cương) ở trang <b>Quà tặng</b>; người tặng kéo
        ngay một con <b>cá to</b> (loài + khoảng cân bên dưới; server bốc cân rồi cộng kg cho người đó). Hành động cho cá to định kỳ chọn ở
        tab <b>Câu cá</b>. Quà tặng không bị chặn bởi cooldown nhưng vẫn xếp hàng đợi. Lane: hai hành động dùng chung lane không chạy cùng
        lúc. <b>Tác động Cá Thần</b> (bình thản / sức bền) server vẫn tính nhưng không còn hiện trên HUD.
      </p>
      <p className="muted">
        Nếu muốn bật lại kích hoạt bằng bình luận cho một hành động: điền từ khoá (so khớp không dấu, theo nguyên từ). <b>Chỉ người đã
        follow:</b> bật thì chỉ cần thủ chính thức (đã follow) mới kích hoạt được bằng bình luận; quà luôn kích hoạt được.
      </p>
      {config.actions.map((a) => (
        <ActionCard key={a.id} action={a} run={run} reloadConfig={reloadConfig} />
      ))}
    </div>
  );
}

function ActionCard({ action, run, reloadConfig }: { action: ActionConfig; run: Run; reloadConfig: () => Promise<void> }) {
  const [form, setForm] = useState(() => toForm(action));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: 'durationMs' | 'cooldownMs' | 'userCooldownMs' | 'priority' | 'points' | 'kingCalm' | 'kingStamina', label: string) => (
    <label>
      {label}
      <input type="number" value={form[k]} onChange={(e) => set(k, Number(e.target.value))} />
    </label>
  );

  const save = () => {
    const fishErr = !form.hasFish
      ? null
      : form.fishEmoji.length < 1 || form.fishEmoji.length > 8
        ? 'emoji cá 1-8 ký tự'
        : form.fishName.trim().length < 1 || form.fishName.length > 40
          ? 'tên cá 1-40 ký tự'
          : !(form.fishMinKg >= 0 && form.fishMaxKg >= form.fishMinKg && form.fishMaxKg <= 10_000)
            ? 'cân cá phải 0 ≤ kg từ ≤ kg đến ≤ 10000'
            : null;
    if (fishErr) return run(() => Promise.reject(new Error(`${action.name}: ${fishErr}`)));
    const keywords = form.keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Có từ khoá → bật kích hoạt bằng bình luận; để trống → chỉ kích hoạt bằng quà (giữ nguyên like/share/follow nếu có).
    const otherKinds = action.trigger.kinds.filter((k) => k !== 'comment');
    const patch: ActionPatch = {
      name: form.name,
      enabled: form.enabled,
      followersOnly: form.followersOnly,
      keywords,
      triggerKinds: keywords.length > 0 ? ['comment', ...otherKinds] : otherKinds,
      durationMs: form.durationMs,
      cooldownMs: form.cooldownMs,
      userCooldownMs: form.userCooldownMs,
      priority: form.priority,
      points: form.points,
      kingCalm: form.kingCalm,
      kingStamina: form.kingStamina,
      fish: form.hasFish ? { emoji: form.fishEmoji, name: form.fishName.trim(), minKg: form.fishMinKg, maxKg: form.fishMaxKg } : null
    };
    return run(() => api.updateAction(action.id, patch).then(reloadConfig), `Đã lưu "${form.name}"`);
  };

  return (
    <section className="card">
      <div className="row">
        {action.fish && <FishThumb actionId={action.id} name={action.fish.name} emoji={action.fish.emoji} size={56} />}
        <h2 style={{ flex: 1, margin: 0 }}>
          {action.name} <code className="muted">{action.id}</code>
          {action.fish && (
            <div className="muted fish-sub">
              {action.fish.name} · {action.fish.minKg}–{action.fish.maxKg} kg
            </div>
          )}
        </h2>
        <label className="inline">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => {
              set('enabled', e.target.checked);
              void run(() => api.updateAction(action.id, { enabled: e.target.checked }).then(reloadConfig), e.target.checked ? 'Đã bật' : 'Đã tắt');
            }}
          />
          Bật
        </label>
        <button onClick={() => run(() => api.trigger(action.id), 'Đã kích hoạt thử')}>Thử</button>
      </div>
      <div className="form-grid">
        <label>
          Tên hiển thị
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="span2">
          Từ khoá bình luận (phân tách bằng dấu phẩy)
          <input value={form.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="Để trống = chỉ kích hoạt bằng quà/sự kiện" />
        </label>
        {num('durationMs', 'Thời lượng (ms)')}
        {num('cooldownMs', 'Hồi chiêu chung (ms)')}
        {num('userCooldownMs', 'Hồi chiêu mỗi người (ms)')}
        {num('priority', 'Ưu tiên')}
        {num('points', 'Điểm cộng')}
        {num('kingCalm', 'Tác động Cá Thần: bình thản')}
        {num('kingStamina', 'Tác động Cá Thần: sức bền')}
        <label className="inline">
          <input type="checkbox" checked={form.followersOnly} onChange={(e) => set('followersOnly', e.target.checked)} />
          Chỉ người đã follow (bình luận)
        </label>
        <label>
          Lane
          <input value={action.lanes.map((l) => LANE_LABELS[l] ?? l).join(', ')} disabled />
        </label>
      </div>
      <div className="loot">
        <label className="inline">
          <input type="checkbox" checked={form.hasFish} onChange={(e) => set('hasFish', e.target.checked)} />
          <b>Kéo được cá to</b>
        </label>
        {form.hasFish ? (
          <div className="form-grid">
            <label>
              Emoji
              <input value={form.fishEmoji} maxLength={8} onChange={(e) => set('fishEmoji', e.target.value)} />
            </label>
            <label>
              Tên loài cá
              <input value={form.fishName} maxLength={40} onChange={(e) => set('fishName', e.target.value)} />
            </label>
            <label>
              Kg từ
              <input type="number" min={0} step={0.5} value={form.fishMinKg} onChange={(e) => set('fishMinKg', Number(e.target.value))} />
            </label>
            <label>
              Kg đến
              <input type="number" min={0} step={0.5} value={form.fishMaxKg} onChange={(e) => set('fishMaxKg', Number(e.target.value))} />
            </label>
          </div>
        ) : (
          <span className="muted">Hành động này không kéo cá (chỉ diễn hoạt ảnh).</span>
        )}
      </div>
      <div className="row">
        <button className="primary" onClick={save}>
          Lưu
        </button>
        <button className="ghost" onClick={() => setForm(toForm(action))}>
          Hoàn tác
        </button>
      </div>
    </section>
  );
}

function toForm(a: ActionConfig) {
  return {
    name: a.name,
    enabled: a.enabled,
    followersOnly: a.trigger.followersOnly ?? false,
    keywords: a.trigger.keywords.join(', '),
    durationMs: a.durationMs,
    cooldownMs: a.cooldownMs,
    userCooldownMs: a.userCooldownMs,
    priority: a.priority,
    points: a.points,
    kingCalm: a.kingEffect.calm,
    kingStamina: a.kingEffect.stamina,
    hasFish: !!a.fish,
    fishEmoji: a.fish?.emoji ?? '🐟',
    fishName: a.fish?.name ?? 'Cá to',
    fishMinKg: a.fish?.minKg ?? 3,
    fishMaxKg: a.fish?.maxKg ?? 6
  };
}
