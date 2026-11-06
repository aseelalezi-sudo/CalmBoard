# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@2.10.7
COPY . .
RUN turbo prune @calmboard/api --docker

FROM node:22-alpine AS installer
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat python3 make g++
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
RUN corepack enable && pnpm turbo run build --filter=@calmboard/api

FROM sourcer AS deployer
RUN --mount=type=cache,id=calmboard-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm --filter=@calmboard/api deploy --prod --legacy --prefer-offline /prod/api

FROM sourcer AS migration-deployer
RUN --mount=type=cache,id=calmboard-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm --filter=@calmboard/database deploy --prod --legacy --prefer-offline /prod/migrations

FROM node:22-alpine AS migrator
WORKDIR /app
ENV NODE_ENV=production
ENV DEPLOY_ENV=production
RUN apk upgrade --no-cache \
    && apk add --no-cache dumb-init \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 migration_user
COPY --from=migration-deployer --chown=migration_user:nodejs /prod/migrations/node_modules ./node_modules
COPY --from=builder --chown=migration_user:nodejs /app/scripts/database-command.mjs /app/scripts/migration-runner.mjs /app/scripts/migration-baseline.mjs ./scripts/
COPY --from=builder --chown=migration_user:nodejs /app/packages/database/migrations ./packages/database/migrations
USER migration_user
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "scripts/database-command.mjs", "migrate"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME="0.0.0.0"

RUN apk upgrade --no-cache \
    && apk add --no-cache dumb-init \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 api_user
RUN mkdir -p /app/data && chown api_user:nodejs /app/data

COPY --from=deployer --chown=api_user:nodejs /prod/api ./
COPY --from=builder --chown=api_user:nodejs /app/scripts/check-env.mjs /app/check-env.mjs

USER api_user
EXPOSE 4000

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "node /app/check-env.mjs --service=api && exec node dist/main.js"]
