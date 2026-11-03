import { useEffect, useState } from 'react';
import type { FishingConfig, GameConfig } from '@cau/shared';
import { api } from '../api';
import type { Notify, Run } from '../App';
import { fromLootRows, LootEditor, toLootRow, validateLoot, type LootRow } from '../components/LootEditor';

interface Form {
  tickSec: number;
  catchesPerTick: number;
  shadowSec: number;
  bigFishEveryMin: number;
  bigFishActionId: string;
  frontSeats: number;
  idleKickMin: number;
  loot: LootRow[];
}

const toForm = (f: FishingConfig): Form => ({
  tickSec: f.tickMs / 1000,
  catchesPerTick: f.catchesPerTick ?? 1,
  shadowSec: (f.bigFishShadowMs ?? 15_000) / 1000,
  bigFishEveryMin: f.bigFishEveryMs / 60_000,
  bigFishActionId: f.bigFishActionId,
  frontSeats: f.frontSeats,
  idleKickMin: f.idleKickMs / 60_000,
  loot: f.loot.map(toLootRow)
});

function validate(f: Form, actionIds: string[]): string[] {
  const errs: string[] = [];
  const tickMs = Math.round(f.tickSec * 1000);
  if (!Number.isFinite(tickMs) || tickMs < 1000 || tickMs > 600_000) errs.push('Chu kỳ câu: 1–600 giây');
  const every = Math.round(f.bigFishEveryMin * 60_000);
  if (!Number.isFinite(every) || every < 0 || every > 24 * 3600_000) errs.push('Cá to định kỳ: 0–1440 phút');
  if (every > 0 && !actionIds.includes(f.bigFishActionId)) errs.push('Chọn hành động cho cá to định kỳ');
  if (!Number.isInteger(f.catchesPerTick) || f.catchesPerTick < 1 || f.catchesPerTick > 50) errs.push('Số cá lên mỗi chu kỳ: số nguyên 1–50');
  const shadow = Math.round(f.shadowSec * 1000);
  if (!Number.isFinite(shadow) || shadow < 0 || shadow > 120_000) errs.push('Bóng cá to hiện trước: 0–120 giây');
  if (!Number.isInteger(f.frontSeats) || f.frontSeats < 0 || f.frontSeats > 12) errs.push('Ghế chiếu VIP: số nguyên 0–12');
  const idle = Math.round(f.idleKickMin * 60_000);
  if (!Number.isFinite(idle) || idle < 0 || idle > 24 * 3600_000) errs.push('Rời hồ khi im lặng: 0–1440 phút');
  return [...errs, ...validateLoot(f.loot)];
}

export function FishingPage({
  config,
  run,
  notify,
  reloadConfig
}: {
  config: GameConfig;
  run: Run;
  notify: Notify;
  reloadConfig: () => Promise<void>;
}) {
  const saved = config.fishing;
  const [form, setForm] = useState<Form | null>(() => (saved ? toForm(saved) : null));
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    setForm(saved ? toForm(saved) : null);
    setErrors([]);
  }, [saved]);

  if (!form) return <p className="muted">Server chưa trả cấu hình câu cá.</p>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (k: 'tickSec' | 'catchesPerTick' | 'shadowSec' | 'bigFishEveryMin' | 'frontSeats' | 'idleKickMin', label: string, step: number, hint?: string) => (
    <label>
      {label}
      <input type="number" min={0} step={step} value={form[k]} onChange={(e) => set(k, Number(e.target.value))} />
      {hint && <span className="muted">{hint}</span>}
    </label>
  );

  const save = () => {
    const errs = validate(
      form,
      config.actions.map((a) => a.id)
    );
    setErrors(errs);
    if (errs.length) {
      notify(`Có ${errs.length} lỗi, chưa lưu`, 'error');
      return;
    }
    const patch: FishingConfig = {
      tickMs: Math.round(form.tickSec * 1000),
      catchesPerTick: form.catchesPerTick,
      bigFishShadowMs: Math.round(form.shadowSec * 1000),
      bigFishEveryMs: Math.round(form.bigFishEveryMin * 60_000),
      bigFishActionId: form.bigFishActionId,
      frontSeats: form.frontSeats,
      idleKickMs: Math.round(form.idleKickMin * 60_000),
      loot: fromLootRows(form.loot)
    };
    return run(() => api.updateFishing(patch).then(reloadConfig), 'Đã lưu cấu hình câu cá');
  };

  const total = form.loot.reduce((s, l) => s + Math.max(0, l.weight), 0);
  const avgKg = total > 0 ? form.loot.reduce((s, l) => s + (Math.max(0, l.weight) / total) * ((l.minKg + l.maxKg) / 2), 0) : 0;

  return (
    <div className="stack">
      <h1>Câu cá</h1>
      <p className="muted">
        Bình luận bất kỳ hoặc tặng quà là vào hồ ngồi câu. Mỗi chu kỳ có <b>vài con cá</b> (số cá lên mỗi chu kỳ) cắn câu lần lượt
        theo thứ tự vào hồ, mỗi con bốc ngẫu nhiên từ bảng cá dưới đây (theo trọng số), cộng kg và điểm cho người câu được. Người tặng quà nhiều nhất phiên (hoà thì câu lâu nhất) được ngồi <b>chiếu VIP</b>, người
        khác chia đều hai bên bờ.
      </p>
      <section className="card">
        <h2>Nhịp câu</h2>
        <div className="form-grid">
          {num('tickSec', 'Chu kỳ câu tự động (giây)', 1, 'Mặc định 5 giây')}
          {num('catchesPerTick', 'Số cá lên mỗi chu kỳ (lần lượt theo thứ tự vào hồ)', 1, '1–50, mặc định 1')}
          {num('frontSeats', 'Số ghế chiếu VIP', 1, '0–12, mặc định 5')}
          {num('idleKickMin', 'Rời hồ khi im lặng (phút)', 1, '0 = không bao giờ')}
          {num('bigFishEveryMin', 'Cá to định kỳ mỗi (phút)', 0.5, '0 = tắt, mặc định 3')}
          {num('shadowSec', 'Bóng cá to hiện trước (giây)', 1, '0–120, mặc định 15')}
          <label className="span2">
            Hành động khi cá to định kỳ xuất hiện
            <select value={form.bigFishActionId} onChange={(e) => set('bigFishActionId', e.target.value)}>
              {!config.actions.some((a) => a.id === form.bigFishActionId) && <option value={form.bigFishActionId}>(không tồn tại) {form.bigFishActionId}</option>}
              {config.actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fish ? `${a.fish.emoji} ` : ''}
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="card">
        <LootEditor loot={form.loot} onChange={(loot) => set('loot', loot)} />
        <p className="muted">
          Cân trung bình mỗi con ≈ <b>{avgKg.toFixed(2)} kg</b> · cả hồ ≈ <b>{form.tickSec > 0 ? ((avgKg * form.catchesPerTick * 60) / form.tickSec).toFixed(1) : 0} kg/phút</b> ({form.tickSec > 0 ? ((form.catchesPerTick * 60) / form.tickSec).toFixed(1) : 0} con/phút, chia lần lượt cho người đang ngồi).
        </p>
      </section>
      {errors.length > 0 && (
        <section className="card">
          {errors.map((e) => (
            <div key={e} className="error">
              {e}
            </div>
          ))}
        </section>
      )}
      <div className="row">
        <button className="primary" onClick={save}>
          Lưu tất cả
        </button>
        <button
          className="ghost"
          onClick={() => {
            setForm(toForm(saved));
            setErrors([]);
          }}
        >
          Hoàn tác
        </button>
      </div>
    </div>
  );
}
