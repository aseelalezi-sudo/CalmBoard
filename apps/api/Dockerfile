# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@2.10.7
COPY . .
RUN turbo prune @calmboard/api --docker

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
RUN corepack enable && pnpm turbo run build --filter=@calmboard/api

FROM sourcer AS deployer
RUN pnpm --filter=@calmboard/api deploy --prod --legacy /prod/api

FROM sourcer AS migrator
ENV NODE_ENV=production
ENV DEPLOY_ENV=production
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/packages/database/migrations ./packages/database/migrations
CMD ["pnpm", "exec", "drizzle-kit", "migrate"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME="0.0.0.0"

RUN apk add --no-cache dumb-init
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 api_user

COPY --from=deployer --chown=api_user:nodejs /prod/api ./

USER api_user
EXPOSE 4000

CMD ["dumb-init", "node", "dist/main.js"]
