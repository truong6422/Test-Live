import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** postgres = dùng DATABASE_URL; memory = không cần DB (chỉ để thử nhanh, mất dữ liệu khi tắt). */
  STORE: z.enum(['postgres', 'memory']).default('postgres'),
  DATABASE_URL: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD phải có ít nhất 8 ký tự'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET phải có ít nhất 32 ký tự'),
  OVERLAY_KEY: z.string().min(8, 'OVERLAY_KEY phải có ít nhất 8 ký tự'),
  /** Đặt true khi chạy sau HTTPS (Nginx có TLS) để cookie có cờ Secure. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TIKTOK_USERNAME: z.string().optional(),
  /** API key của sign server (Euler Stream) nếu cần. Chỉ nằm ở server. */
  TIKTOK_SIGN_API_KEY: z.string().optional(),
  HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Thư mục chứa bản build của overlay và admin. */
  STATIC_DIR: z.string().optional()
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Biến môi trường không hợp lệ:\n${msg}\nXem .env.example`);
  }
  const env = parsed.data;
  if (env.STORE === 'postgres' && !env.DATABASE_URL) {
    throw new Error('STORE=postgres cần DATABASE_URL');
  }
  return env;
}
