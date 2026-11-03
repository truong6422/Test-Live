import { useEffect, useMemo, useState } from 'react';
import type { GameConfig, GiftMapping, HistoryEntry } from '@cau/shared';
import { api } from '../api';
import type { Run } from '../App';
import { FishThumb } from '../components/FishSprite';

export function GiftsPage({
  config,
  run,
  reloadConfig,
  liveHistory
}: {
  config: GameConfig;
  run: Run;
  reloadConfig: () => Promise<void>;
  liveHistory: HistoryEntry[];
}) {
  const [rows, setRows] = useState<GiftMapping[]>(config.gifts);
  useEffect(() => setRows(config.gifts), [config.gifts]);

  const tiers = rows.filter((g) => g.giftId === 0 && g.enabled).sort((a, b) => (a.minDiamonds ?? 0) - (b.minDiamonds ?? 0));

  const effectOf = (actionId: string, size = 32) => {
    const a = config.actions.find((x) => x.id === actionId);
    if (!a) return '—';
    if (!a.fish) return '(không kéo cá)';
    return (
      <span className="fish-cell">
        <FishThumb actionId={a.id} name={a.fish.name} emoji={a.fish.emoji} size={size} />
        <span>
          {a.fish.name} <span className="muted">{a.fish.minKg}–{a.fish.maxKg} kg</span>
        </span>
      </span>
    );
  };

  const update = (i: number, patch: Partial<GiftMapping>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // Gift ID đã thấy gần đây (từ lịch sử realtime) để admin dễ thêm mapping.
  const seen = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of liveHistory) {
      const match = h.summary.match(/Tặng \d+x (.+?) \(id (\d+)[,)]/);
      if (match) m.set(match[2]!, match[1]!);
    }
    return [...m.entries()];
  }, [liveHistory]);

  return (
    <div className="stack">
      <h1>Bậc quà tặng</h1>
      <p className="muted">
        Tặng quà là <b>kéo cá to</b> ngay — quà càng giá trị, cá càng to. Bậc chọn theo giá trị quà: tổng giá trị = kim cương của một món × số lượng (đã gộp combo).
      </p>
      <p className="muted">
        Cách chọn: dòng có <b>đúng Gift ID</b> thắng trước; không có thì xét các bậc Gift ID <b>0</b> (mọi quà khác) và chọn bậc có "Từ (kim
        cương)" cao nhất mà vẫn ≤ tổng giá trị. Không rõ giá trị (0 kim cương) thì lấy bậc thấp nhất. Dòng phải đang bật và "Số lượng tối
        thiểu" ≤ số quà; hoà nhau thì dòng có số lượng tối thiểu cao hơn thắng.
      </p>
      {tiers.length > 0 && (
        <section className="card">
          <h2>Các bậc hiện tại (Gift ID 0)</h2>
          <div className="tiers">
            {tiers.map((g, i) => (
              <div key={i} className="tier-card">
                <span className="tier-from">từ {g.minDiamonds ?? 0} 💎</span>
                {effectOf(g.actionId, 64)}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Gift ID</th>
              <th>Tên quà</th>
              <th>Hành động</th>
              <th>Số lượng tối thiểu</th>
              <th>Từ (kim cương)</th>
              <th>Cá to kéo được</th>
              <th>Bật</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((g, i) => (
              <tr key={i}>
                <td>
                  <input type="number" min={0} value={g.giftId} onChange={(e) => update(i, { giftId: Number(e.target.value) })} />
                </td>
                <td>
                  <input value={g.giftName} onChange={(e) => update(i, { giftName: e.target.value })} />
                </td>
                <td>
                  <select value={g.actionId} onChange={(e) => update(i, { actionId: e.target.value })}>
                    {config.actions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="number" min={1} value={g.minCount} onChange={(e) => update(i, { minCount: Number(e.target.value) })} />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={g.minDiamonds ?? 0}
                    onChange={(e) => update(i, { minDiamonds: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  />
                </td>
                <td>{effectOf(g.actionId)}</td>
                <td>
                  <input type="checkbox" checked={g.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                </td>
                <td>
                  <button className="ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                    Xoá
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button
            onClick={() =>
              setRows((r) => [...r, { giftId: 0, giftName: 'Quà mới', actionId: config.actions[0]!.id, minCount: 1, minDiamonds: 0, enabled: true }])
            }
          >
            + Thêm dòng
          </button>
          <button className="primary" onClick={() => run(() => api.updateGifts(rows).then(reloadConfig), 'Đã lưu mapping quà')}>
            Lưu tất cả
          </button>
        </div>
      </section>
      {seen.length > 0 && (
        <section className="card">
          <h2>Quà vừa nhận trong phiên</h2>
          <div className="row wrap">
            {seen.map(([id, name]) => (
              <button
                key={id}
                className="ghost"
                onClick={() => setRows((r) => [...r, { giftId: Number(id), giftName: name, actionId: config.actions[0]!.id, minCount: 1, minDiamonds: 0, enabled: true }])}
              >
                + {name} (id {id})
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
