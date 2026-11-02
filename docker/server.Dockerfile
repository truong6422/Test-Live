# syntax=docker/dockerfile:1
# Image nhẹ: build overlay + admin (Vite) và bundle server thành 1 file JS.
# Runtime chỉ còn Bun + index.js + migrations + file tĩnh (không có node_modules).

FROM oven/bun:1.4-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/overlay/package.json apps/overlay/
COPY apps/admin/package.json apps/admin/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun run build \
 && bun build apps/server/src/index.ts --target bun --minify --outdir /app/out

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STATIC_DIR=/app/static \
    MIGRATIONS_DIR=/app/migrations
COPY --from=build /app/out/index.js /app/index.js
COPY --from=build /app/apps/server/src/db/migrations /app/migrations
COPY --from=build /app/apps/overlay/dist /app/static/overlay
COPY --from=build /app/apps/admin/dist /app/static/admin
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["bun", "/app/index.js"]
