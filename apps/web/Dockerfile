# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@2.10.7
COPY . .
RUN turbo prune @calmboard/web --docker

FROM node:22-alpine AS installer
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN corepack enable && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=calmboard-pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM node:22-alpine AS sourcer
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=builder /app/out/full/ .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_REALTIME_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
ARG NEXT_PUBLIC_TELEMETRY_UI_ENABLED=false
ARG NEXT_PUBLIC_WEBAUTHN_UI_ENABLED=false
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=${NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE}
ENV NEXT_PUBLIC_TELEMETRY_UI_ENABLED=${NEXT_PUBLIC_TELEMETRY_UI_ENABLED}
ENV NEXT_PUBLIC_WEBAUTHN_UI_ENABLED=${NEXT_PUBLIC_WEBAUTHN_UI_ENABLED}
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && pnpm turbo run build --filter=@calmboard/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN apk add --no-cache dumb-init \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=sourcer /app/apps/web/public ./apps/web/public
RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=sourcer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=sourcer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

CMD ["dumb-init", "node", "apps/web/server.js"]
