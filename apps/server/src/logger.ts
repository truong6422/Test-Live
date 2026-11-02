type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

/** Log JSON một dòng — dễ đọc bằng `docker compose logs` và dễ gom bằng công cụ log. */
export function createLogger(level: Level = 'info', scope = 'app'): Logger {
  const min = ORDER[level];
  const write = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const line = JSON.stringify({ t: new Date().toISOString(), lvl, scope, msg, ...fields }, (_k, v) =>
      v instanceof Error ? { message: v.message, stack: v.stack } : v
    );
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (s) => createLogger(level, `${scope}:${s}`)
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger
};
