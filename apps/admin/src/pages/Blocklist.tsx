import { useEffect, useMemo, useState } from 'react';
import type { GameConfig } from '@cau/shared';
import { api } from '../api';
import type { Run } from '../App';

const MAX_WORDS = 1000;
const MAX_LEN = 40;

/** Chuẩn hoá giống server: NFC, chữ thường, bỏ dấu câu đầu/cuối. */
const norm = (w: string) =>
  w
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');

/**
 * Bộ lọc từ: từ tục / xúc phạm bị che bằng dấu sao trong TÊN và BÌNH LUẬN trước khi lên overlay.
 * So khớp theo nguyên từ, không phân biệt hoa thường, GIỮ dấu (bỏ dấu sẽ che nhầm từ thường như "các", "lớn").
 */
export function BlocklistPage({ config, run, reloadConfig }: { config: GameConfig; run: Run; reloadConfig: () => Promise<void> }) {
  const saved = config.blocklist ?? [];
  const [words, setWords] = useState<string[]>(saved);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');
  const [sample, setSample] = useState('Cá to vcl các bác ơi, ĐM!! câu lớn quá');
  const [result, setResult] = useState<{ comment: string; displayName: string } | null>(null);
  const [testErr, setTestErr] = useState('');

  useEffect(() => setWords(config.blocklist ?? []), [config.blocklist]);

  const dirty = words.length !== saved.length || words.some((w, i) => w !== saved[i]);

  // Thử bộ lọc nháp (chưa lưu) trên server — cùng một hàm làm sạch với dữ liệu TikTok thật.
  useEffect(() => {
    const h = setTimeout(() => {
      if (!sample.trim()) {
        setResult(null);
        return;
      }
      api
        .testBlocklist(sample, words)
        .then((r) => {
          setResult(r);
          setTestErr('');
        })
        .catch((e: unknown) => setTestErr(e instanceof Error ? e.message : String(e)));
    }, 300);
    return () => clearTimeout(h);
  }, [sample, words]);

  const add = () => {
    // Cho dán nhiều từ một lúc: phân tách bằng dấu phẩy / xuống dòng / khoảng trắng.
    const incoming = input
      .split(/[\s,;]+/)
      .map(norm)
      .filter(Boolean);
    const tooLong = incoming.find((w) => [...w].length > MAX_LEN);
    if (tooLong) return run(() => Promise.reject(new Error(`Từ quá dài (tối đa ${MAX_LEN} ký tự): ${tooLong}`)));
    const next = [...words];
    for (const w of incoming) if (!next.includes(w)) next.push(w);
    if (next.length > MAX_WORDS) return run(() => Promise.reject(new Error(`Tối đa ${MAX_WORDS} từ`)));
    setWords(next);
    setInput('');
  };

  const shown = useMemo(() => {
    const f = norm(filter);
    return words.filter((w) => !f || w.includes(f));
  }, [words, filter]);

  return (
    <div className="stack">
      <h1>Bộ lọc từ</h1>
      <p className="muted">
        Từ trong danh sách bị <b>che bằng dấu sao</b> trong tên và bình luận của người xem trước khi hiện lên overlay (ví dụ "vcl" → "***").
        So khớp theo <b>nguyên từ</b>, không phân biệt hoa thường, <b>giữ dấu</b> — "đm" không che "đám", "dm" không che "dám". Mỗi mục là
        một từ (không có khoảng trắng). Lưu xong áp dụng ngay cho sự kiện mới.
      </p>

      <section className="card">
        <div className="row">
          <h2 style={{ flex: 1, margin: 0 }}>Danh sách ({words.length} từ)</h2>
          {dirty && <span className="pill yellow">Chưa lưu</span>}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input placeholder="Thêm từ (có thể dán nhiều từ, cách nhau bởi dấu phẩy / khoảng trắng)" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="primary" disabled={!input.trim()}>
            + Thêm
          </button>
        </form>
        {words.length > 12 && (
          <div className="row">
            <input placeholder="Tìm trong danh sách…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        )}
        {words.length === 0 ? (
          <p className="muted">Danh sách trống — không che từ nào.</p>
        ) : (
          <div className="chips">
            {shown.map((w) => (
              <span key={w} className="chip">
                {w}
                <button className="icon" title={`Bỏ "${w}"`} onClick={() => setWords((ws) => ws.filter((x) => x !== w))}>
                  ✕
                </button>
              </span>
            ))}
            {shown.length === 0 && <span className="muted">Không có từ khớp "{filter}".</span>}
          </div>
        )}
        <div className="row">
          <button
            className="primary"
            disabled={!dirty}
            onClick={() => run(() => api.updateBlocklist(words).then(reloadConfig), `Đã lưu bộ lọc (${words.length} từ)`)}
          >
            Lưu bộ lọc
          </button>
          <button className="ghost" disabled={!dirty} onClick={() => setWords(saved)}>
            Hoàn tác
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Thử bộ lọc</h2>
        <p className="muted">Gõ thử một bình luận / tên — kết quả dùng danh sách đang sửa ở trên (kể cả khi chưa lưu).</p>
        <textarea rows={3} maxLength={500} value={sample} onChange={(e) => setSample(e.target.value)} />
        {testErr && <div className="error">{testErr}</div>}
        {result && (
          <dl className="test-result">
            <dt>Bình luận hiển thị</dt>
            <dd>{result.comment || <span className="muted">(trống)</span>}</dd>
            <dt>Tên hiển thị (cắt 24 ký tự)</dt>
            <dd>{result.displayName}</dd>
          </dl>
        )}
      </section>
    </div>
  );
}
