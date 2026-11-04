import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Gọi `load` ngay và lặp lại mỗi `ms`. Tạm dừng khi tab trình duyệt bị ẩn (admin để mở hàng giờ cạnh OBS)
 * và tải lại ngay khi tab hiện lại. `deps` đổi → chạy lại từ đầu.
 */
export function usePolling(load: () => void, ms: number, deps: unknown[] = []) {
  const fn = useRef(load);
  fn.current = load;
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(t);
      fn.current();
      t = setInterval(() => fn.current(), ms);
    };
    const onVis = () => {
      if (document.hidden) clearInterval(t);
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}

/**
 * Chặn bấm liên tiếp: `wrap(fn)` trả hàm chỉ chạy khi chưa có việc nào đang chờ; `busy` = đang chờ.
 * Dùng cho nút gọi API (bắt đầu/dừng game, kết nối, demo…) để bấm đúp không gửi hai lệnh.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wrap = useCallback(
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
      async (...args: A) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
          await fn(...args);
        } finally {
          pending.current = false;
          if (mounted.current) setBusy(false);
        }
      },
    []
  );
  return { busy, wrap };
}

/**
 * Xác nhận bằng hai lần bấm (không dùng hộp thoại confirm chặn màn hình giữa LIVE):
 * lần 1 → `armed` = true trong `ms`; bấm lần 2 trong thời gian đó mới chạy.
 */
export function useArm(ms = 4000) {
  const [armed, setArmed] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const disarm = useCallback(() => {
    clearTimeout(t.current);
    setArmed(false);
  }, []);
  const arm = useCallback(() => {
    clearTimeout(t.current);
    setArmed(true);
    t.current = setTimeout(() => setArmed(false), ms);
  }, [ms]);
  return { armed, arm, disarm };
}

/** Đồng hồ chạy theo giờ server (bù lệch giờ máy theo snapshot.serverTime), nhảy mỗi giây. */
export function useServerNow(serverTime: number): number {
  const [offset] = useState(() => serverTime - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}
