import { useEffect, useState } from 'react';
import type { GameConfig, WorkTask } from '@cau/shared';
import { api } from '../api';
import type { Notify, Run } from '../App';

const ID_RE = /^[a-z0-9_]{1,40}$/;

interface Row {
  /** Khoá React ổn định (id có thể đổi khi đang gõ). */
  key: string;
  id: string;
  /** Dòng mới: id chưa lưu, còn sửa được. */
  isNew: boolean;
  /** Người dùng đã tự gõ id → không tự sinh từ tên nữa. */
  idTouched: boolean;
  name: string;
  enabled: boolean;
  keywords: string;
  emoji: string;
  text: string;
  points: number;
  userCooldownMs: number;
}

let keySeq = 0;
const toRow = (t: WorkTask): Row => ({
  key: `k${keySeq++}`,
  id: t.id,
  isNew: false,
  idTouched: true,
  name: t.name,
  enabled: t.enabled,
  keywords: t.keywords.join(', '),
  emoji: t.emoji,
  text: t.text,
  points: t.points,
  userCooldownMs: t.userCooldownMs
});

/** "Thay mồi" → "thay_moi". */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const splitKeywords = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Trả về danh sách lỗi (tiếng Việt) — khớp validation phía server. */
function validate(rows: Row[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const at = `Dòng ${i + 1}${r.name ? ` ("${r.name}")` : ''}`;
    if (!ID_RE.test(r.id)) errs.push(`${at}: id chỉ gồm a-z, 0-9, _ (1-40 ký tự)`);
    else if (seen.has(r.id)) errs.push(`${at}: id "${r.id}" bị trùng`);
    seen.add(r.id);
    if (r.name.trim().length < 1 || r.name.length > 60) errs.push(`${at}: tên 1-60 ký tự`);
    const kws = splitKeywords(r.keywords);
    if (kws.length > 30) errs.push(`${at}: tối đa 30 từ khoá`);
    if (kws.some((k) => k.length > 40)) errs.push(`${at}: mỗi từ khoá tối đa 40 ký tự`);
    if (r.emoji.length < 1 || r.emoji.length > 8) errs.push(`${at}: emoji 1-8 ký tự`);
    if (r.text.length > 80) errs.push(`${at}: câu nói tối đa 80 ký tự`);
    if (!Number.isInteger(r.points) || r.points < 0) errs.push(`${at}: điểm là số nguyên ≥ 0`);
    if (!Number.isInteger(r.userCooldownMs) || r.userCooldownMs < 0 || r.userCooldownMs > 600_000)
      errs.push(`${at}: hồi chiêu 0-600000 ms`);
  });
  return errs;
}

const fromRow = (r: Row): WorkTask => ({
  id: r.id,
  name: r.name.trim(),
  enabled: r.enabled,
  keywords: splitKeywords(r.keywords),
  emoji: r.emoji,
  text: r.text,
  points: r.points,
  userCooldownMs: r.userCooldownMs
});

export function WorkPage({
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
  // Server cũ có thể chưa trả `work`.
  const saved = config.work ?? [];
  const [rows, setRows] = useState<Row[]>(() => saved.map(toRow));
  const [errors, setErrors] = useState<string[]>([]);
  // So theo NỘI DUNG (không theo tham chiếu): reloadConfig sau khi lưu trang khác tạo object mới → không được xoá phần đang sửa dở ở trang này.
  useEffect(() => {
    setRows(saved.map(toRow));
    setErrors([]);
  }, [JSON.stringify(config.work ?? [])]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Dòng mới: id tự sinh theo tên cho tới khi người dùng tự sửa id.
        if (next.isNew && !next.idTouched && patch.name !== undefined) next.id = uniqueId(slugify(next.name) || 'viec_cau', rs, key);
        return next;
      })
    );

  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        key: `k${keySeq++}`,
        id: uniqueId('viec_cau_moi', rs),
        isNew: true,
        idTouched: false,
        name: 'Việc câu mới',
        enabled: true,
        keywords: '',
        emoji: '🎣',
        text: '',
        points: 1,
        userCooldownMs: 20_000
      }
    ]);

  const save = () => {
    const errs = validate(rows);
    setErrors(errs);
    if (errs.length) {
      notify(`Có ${errs.length} lỗi, chưa lưu`, 'error');
      return;
    }
    return run(() => api.updateWork(rows.map(fromRow)).then(reloadConfig), 'Đã lưu việc câu');
  };

  return (
    <div className="stack">
      <h1>Biểu cảm bình luận</h1>
      <p className="muted">
        Việc câu miễn phí: người xem gõ bình luận để cần thủ của họ diễn biểu cảm vui ngay tại chỗ (thay mồi, uống trà đá, hát hò…), được cộng
        điểm — giữ chân người xem. Không ảnh hưởng Cá Thần. Câu cá tự động và bảng cá nằm ở tab <b>Câu tự động</b>.
      </p>
      <p className="muted">
        Từ khoá so khớp không dấu, theo nguyên từ (giống tab Cá to (quà)). Hồi chiêu tính riêng cho từng người xem.
      </p>
      {rows.length === 0 && (
        <section className="card">
          <p className="muted">Chưa có việc câu nào.</p>
        </section>
      )}
      {rows.map((r) => (
        <section className="card" key={r.key}>
          <div className="row">
            <h2 style={{ flex: 1 }}>
              {r.emoji} {r.name || '(chưa đặt tên)'} {!r.isNew && <code className="muted">{r.id}</code>}
            </h2>
            <label className="inline">
              <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.key, { enabled: e.target.checked })} />
              Bật
            </label>
            <button className="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
              Xoá
            </button>
          </div>
          <div className="form-grid">
            <label>
              Tên hiển thị
              <input value={r.name} maxLength={60} onChange={(e) => update(r.key, { name: e.target.value })} />
            </label>
            {r.isNew ? (
              <label>
                ID (a-z, 0-9, _)
                <input
                  value={r.id}
                  maxLength={40}
                  style={ID_RE.test(r.id) ? undefined : { borderColor: 'var(--red)' }}
                  onChange={(e) => update(r.key, { id: e.target.value, idTouched: true })}
                />
              </label>
            ) : null}
            <label className="span2">
              Từ khoá bình luận (phân tách bằng dấu phẩy)
              <input value={r.keywords} onChange={(e) => update(r.key, { keywords: e.target.value })} placeholder="vd: cau, quang can" />
            </label>
            <label>
              Emoji
              <input value={r.emoji} maxLength={8} onChange={(e) => update(r.key, { emoji: e.target.value })} />
            </label>
            <label className="span2">
              Câu cần thủ nói (≤ 80 ký tự)
              <input value={r.text} maxLength={80} onChange={(e) => update(r.key, { text: e.target.value })} />
            </label>
            <label>
              Điểm cộng
              <input type="number" min={0} value={r.points} onChange={(e) => update(r.key, { points: Number(e.target.value) })} />
            </label>
            <label>
              Hồi chiêu mỗi người (ms)
              <input
                type="number"
                min={0}
                max={600_000}
                step={1000}
                value={r.userCooldownMs}
                onChange={(e) => update(r.key, { userCooldownMs: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>
      ))}
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
        <button onClick={add}>+ Thêm việc câu</button>
        <button className="primary" onClick={save}>
          Lưu tất cả
        </button>
        <button
          className="ghost"
          onClick={() => {
            setRows(saved.map(toRow));
            setErrors([]);
          }}
        >
          Hoàn tác
        </button>
      </div>
    </div>
  );
}

function uniqueId(base: string, rows: Row[], exceptKey?: string): string {
  const taken = new Set(rows.filter((r) => r.key !== exceptKey).map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const id = base.slice(0, 40 - suffix.length) + suffix;
    if (!taken.has(id)) return id;
  }
}

