import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'sep_admin';
export const SESSION_TTL_MS = 12 * 3600_000;

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Token phiên admin: `<hết hạn>.<HMAC-SHA256>` — không cần lưu phía server. */
export function signSession(secret: string, now = Date.now(), ttlMs = SESSION_TTL_MS): string {
  const exp = String(now + ttlMs);
  const sig = b64url(createHmac('sha256', secret).update(exp).digest());
  return `${exp}.${sig}`;
}

export function verifySession(secret: string, token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  const expected = createHmac('sha256', secret).update(exp).digest();
  const given = Buffer.from(sig, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** So sánh chuỗi an toàn về thời gian (mật khẩu, overlay key). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
