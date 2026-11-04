import type { LootItem } from '@cau/shared';
import { FishThumb } from './FishSprite';

/** Một dòng trong bảng loot (thêm khoá React ổn định). */
export interface LootRow extends LootItem {
  key: string;
}

let seq = 0;
export const toLootRow = (l: LootItem): LootRow => ({ key: `l${seq++}`, ...l });
export const newLootRow = (): LootRow => toLootRow({ emoji: '🐟', name: 'Cá mới', weight: 10, minKg: 0.5, maxKg: 2, points: 1 });
export const fromLootRows = (rows: LootRow[]): LootItem[] => rows.map(({ key: _key, ...l }) => ({ ...l, name: l.name.trim() }));

/** Lỗi (tiếng Việt) — khớp lootItemSchema phía server. */
export function validateLoot(loot: LootRow[]): string[] {
  const errs: string[] = [];
  if (loot.length === 0) errs.push('Bảng cá trống — cần ít nhất 1 món');
  if (loot.length > 40) errs.push('Tối đa 40 món');
  if (loot.length > 0 && loot.every((l) => l.weight <= 0)) errs.push('Cần ít nhất 1 món có trọng số > 0');
  loot.forEach((l, j) => {
    const at = `Món ${j + 1}${l.name ? ` ("${l.name}")` : ''}`;
    if (l.emoji.length < 1 || l.emoji.length > 8) errs.push(`${at}: emoji 1-8 ký tự`);
    if (l.name.trim().length < 1 || l.name.length > 40) errs.push(`${at}: tên 1-40 ký tự`);
    if (!Number.isFinite(l.weight) || l.weight < 0 || l.weight > 10_000) errs.push(`${at}: trọng số 0-10000`);
    if (!Number.isFinite(l.minKg) || l.minKg < 0 || l.minKg > 1000) errs.push(`${at}: kg tối thiểu 0-1000`);
    if (!Number.isFinite(l.maxKg) || l.maxKg < 0 || l.maxKg > 1000) errs.push(`${at}: kg tối đa 0-1000`);
    else if (l.maxKg < l.minKg) errs.push(`${at}: kg tối đa phải ≥ kg tối thiểu`);
    if (!Number.isInteger(l.points) || l.points < 0) errs.push(`${at}: điểm thưởng là số nguyên ≥ 0`);
  });
  return errs;
}

/** Bảng loot: mỗi dòng một món có thể câu được. Cột "Tỉ lệ" tính từ trọng số. */
export function LootEditor({ loot, onChange }: { loot: LootRow[]; onChange: (loot: LootRow[]) => void }) {
  const total = loot.reduce((s, l) => s + (l.weight > 0 ? l.weight : 0), 0);
  const set = (key: string, patch: Partial<LootItem>) => onChange(loot.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const num = (key: string, k: 'weight' | 'minKg' | 'maxKg' | 'points', value: number, step: number) => (
    <input type="number" min={0} step={step} value={value} onChange={(e) => set(key, { [k]: Number(e.target.value) })} />
  );
  return (
    <div className="loot">
      <div className="row">
        <h3 style={{ flex: 1 }}>🎏 Bảng cá ({loot.length} món)</h3>
      </div>
      <div className="table-scroll">
      <table className="dense">
        <thead>
          <tr>
            <th style={{ width: 120 }} title="Ảnh lấy từ sprite cá thường của overlay (nếu có), không thì hiện emoji">
              Ảnh / Emoji
            </th>
            <th>Tên món</th>
            <th style={{ width: 100 }}>Trọng số</th>
            <th style={{ width: 70 }}>Tỉ lệ</th>
            <th style={{ width: 100 }}>Kg từ</th>
            <th style={{ width: 100 }}>Kg đến</th>
            <th style={{ width: 100 }}>Điểm thưởng</th>
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {loot.map((l) => (
            <tr key={l.key}>
              <td>
                <span className="fish-cell">
                  <FishThumb small name={l.name} emoji={l.emoji || '🐟'} size={30} />
                  <input value={l.emoji} maxLength={8} onChange={(e) => set(l.key, { emoji: e.target.value })} />
                </span>
              </td>
              <td>
                <input value={l.name} maxLength={40} onChange={(e) => set(l.key, { name: e.target.value })} />
              </td>
              <td>{num(l.key, 'weight', l.weight, 1)}</td>
              <td className="muted">{total > 0 && l.weight > 0 ? `${((l.weight / total) * 100).toFixed(1)}%` : '0%'}</td>
              <td>{num(l.key, 'minKg', l.minKg, 0.1)}</td>
              <td>{num(l.key, 'maxKg', l.maxKg, 0.1)}</td>
              <td>{num(l.key, 'points', l.points, 1)}</td>
              <td>
                <button className="ghost" title="Xoá món" onClick={() => onChange(loot.filter((x) => x.key !== l.key))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="row">
        <button onClick={() => onChange([...loot, newLootRow()])} disabled={loot.length >= 40}>
          + Thêm món
        </button>
        <span className="muted">Kg 0–0 = rác (ủng rách, tất thối…).</span>
      </div>
    </div>
  );
}
