import { useState } from 'react';
import type { ActionConfig, GameConfig } from '@sep/shared';
import { api, type ActionPatch } from '../api';
import type { Run } from '../App';

export function ActionsPage({ config, run, reloadConfig }: { config: GameConfig; run: Run; reloadConfig: () => Promise<void> }) {
  return (
    <div className="stack">
      <h1>Hành động</h1>
      <p className="muted">
        Trêu Sếp <b>chỉ bằng quà tặng</b>: mỗi hành động được kích hoạt theo giá trị quà (kim cương) ở trang <b>Mapping quà</b>. Mặc định
        hành động không có từ khoá bình luận — bình luận dành cho Công việc miễn phí và góp sức Đình công. Quà tặng không bị chặn bởi
        cooldown nhưng vẫn xếp hàng đợi. Lane: hai hành động dùng chung lane không chạy cùng lúc.
      </p>
      <p className="muted">
        Nếu muốn bật lại kích hoạt bằng bình luận cho một hành động: điền từ khoá (so khớp không dấu, theo nguyên từ). <b>Chỉ người đã
        follow:</b> bật thì chỉ nhân viên chính thức (đã follow) mới kích hoạt được bằng bình luận; quà luôn kích hoạt được.
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
  const num = (k: 'durationMs' | 'cooldownMs' | 'userCooldownMs' | 'priority' | 'points' | 'bossCalm' | 'bossStamina', label: string) => (
    <label>
      {label}
      <input type="number" value={form[k]} onChange={(e) => set(k, Number(e.target.value))} />
    </label>
  );

  const save = () => {
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
      bossCalm: form.bossCalm,
      bossStamina: form.bossStamina
    };
    return run(() => api.updateAction(action.id, patch).then(reloadConfig), `Đã lưu "${form.name}"`);
  };

  return (
    <section className="card">
      <div className="row">
        <h2 style={{ flex: 1 }}>
          {action.name} <code className="muted">{action.id}</code>
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
        {num('bossCalm', 'Đổi bình tĩnh Sếp')}
        {num('bossStamina', 'Đổi sức chịu đựng')}
        <label className="inline">
          <input type="checkbox" checked={form.followersOnly} onChange={(e) => set('followersOnly', e.target.checked)} />
          Chỉ người đã follow (bình luận)
        </label>
        <label>
          Lane
          <input value={action.lanes.join(', ')} disabled />
        </label>
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
    bossCalm: a.bossEffect.calm,
    bossStamina: a.bossEffect.stamina
  };
}
