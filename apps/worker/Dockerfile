# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@2.10.7
COPY . .
RUN turbo prune @calmboard/worker --docker

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
RUN corepack enable && pnpm turbo run build --filter=@calmboard/worker

FROM sourcer AS deployer
RUN --mount=type=cache,id=calmboard-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm --filter=@calmboard/worker deploy --prod --legacy --prefer-offline /prod/worker

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache dumb-init \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 worker_user

COPY --from=deployer --chown=worker_user:nodejs /prod/worker ./
COPY --from=builder --chown=worker_user:nodejs /app/scripts/check-env.mjs /app/check-env.mjs

USER worker_user
EXPOSE 3002

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "node /app/check-env.mjs --service=worker && exec node dist/main.js"]
