import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Notify, Run } from '../App';

/** Kích thước gốc của overlay (OBS Browser Source). */
const OVERLAY_W = 1080;
const OVERLAY_H = 1920;
const PREVIEW_W = 252;
const SCALE = PREVIEW_W / OVERLAY_W;
const STORAGE_KEY = 'cau.preview.on';

/**
 * Xem trước overlay ngay trên dashboard (khung 9:16 thu nhỏ) + mở overlay / sao chép URL cho OBS.
 * URL có OVERLAY_KEY nên chỉ lấy qua API có xác thực, không hiện nguyên văn trên màn hình.
 */
export function LivePreview({ run, notify }: { run: Run; notify: Notify }) {
  const [path, setPath] = useState<string | null>(null);
  const [on, setOn] = useState(() => localStorage.getItem(STORAGE_KEY) !== '0');
  const [reloadKey, setReloadKey] = useState(0);
  // Tab trình duyệt bị ẩn (đang ở cửa sổ OBS) → gỡ iframe: overlay trong khung là cả một cảnh PixiJS + WS, chạy hàng giờ tốn CPU/RAM.
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onVis = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    void run(api.overlayUrl).then((r) => r && setPath(r.path));
  }, [run]);

  const toggle = () => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? '0' : '1');
    } catch {
      /* bỏ qua */
    }
    setOn(!on);
  };
  const fullUrl = path ? new URL(path, location.origin).toString() : '';

  const copy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      notify('Đã sao chép URL overlay — dán vào OBS Browser Source (1080×1920)');
    } catch {
      // Trình duyệt chặn clipboard (http không phải localhost…): cho người dùng tự chép.
      window.prompt('Sao chép URL overlay cho OBS:', fullUrl);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>📺 Xem trước hồ câu</h2>
        <button className="ghost" onClick={toggle}>
          {on ? 'Ẩn khung' : 'Hiện khung'}
        </button>
      </div>
      <div className="preview-wrap">
        <div className="preview-frame" style={{ width: PREVIEW_W, height: (PREVIEW_W * OVERLAY_H) / OVERLAY_W }}>
          {on && path && pageVisible ? (
            <iframe
              key={reloadKey}
              title="Overlay hồ câu"
              src={path}
              width={OVERLAY_W}
              height={OVERLAY_H}
              style={{ transform: `scale(${SCALE})` }}
              referrerPolicy="no-referrer"
              tabIndex={-1}
            />
          ) : (
            <div className="preview-off muted">{path ? 'Khung xem trước đang ẩn (đỡ tốn CPU).' : 'Đang lấy URL overlay…'}</div>
          )}
        </div>
        <div className="stack preview-side">
          <button className="primary" disabled={!path} onClick={() => window.open(fullUrl, '_blank', 'noopener,noreferrer')}>
            Mở overlay
          </button>
          <button disabled={!path} onClick={copy}>
            Sao chép URL cho OBS
          </button>
          <button className="ghost" disabled={!path || !on} onClick={() => setReloadKey((k) => k + 1)}>
            Tải lại khung
          </button>
          <p className="muted">
            OBS: <b>Browser Source</b> 1080×1920, dán URL vừa sao chép.
          </p>
          <p className="muted warn-text">⚠️ URL có khoá bí mật — không chia sẻ, không để lộ lên màn hình LIVE.</p>
        </div>
      </div>
    </section>
  );
}
