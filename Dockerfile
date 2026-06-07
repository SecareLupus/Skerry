# ── Builder stage: shared across all targets ──
FROM node:20-slim AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.12.2
WORKDIR /app

# Copy package manifests first (layer caching for installs)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/control-plane/package.json apps/control-plane/tsconfig.json apps/control-plane/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/next.config.js apps/web/
COPY apps/sticker-renderer/package.json apps/sticker-renderer/tsconfig.json apps/sticker-renderer/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/src packages/shared/src
COPY apps/control-plane/src apps/control-plane/src
COPY apps/control-plane/migrations apps/control-plane/migrations
COPY apps/web/app apps/web/app
COPY apps/web/components apps/web/components
COPY apps/web/context apps/web/context
COPY apps/web/hooks apps/web/hooks
COPY apps/web/lib apps/web/lib
COPY apps/web/public apps/web/public
COPY apps/web/*.ts apps/web/*.tsx apps/web/next-env.d.ts apps/web/
COPY apps/sticker-renderer/src apps/sticker-renderer/src

# Build everything
ARG NEXT_PUBLIC_BASE_DOMAIN
RUN echo "NEXT_PUBLIC_BASE_DOMAIN=${NEXT_PUBLIC_BASE_DOMAIN:-localhost}" > apps/web/.env && \
    echo "NEXT_PUBLIC_BASE_DOMAIN=${NEXT_PUBLIC_BASE_DOMAIN:-localhost}" > .env && \
    pnpm --filter @skerry/shared build && \
    pnpm --filter @skerry/control-plane build && \
    pnpm --filter @skerry/web build && \
    pnpm --filter @skerry/sticker-renderer build


# ── Web Runtime (~60-80 MB) ──
FROM node:20-slim AS web
WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]


# ── Control Plane Runtime (~80-100 MB) ──
FROM builder AS cp-deploy
RUN pnpm --filter @skerry/control-plane --prod deploy /app/out

FROM node:20-slim AS control-plane
WORKDIR /app
COPY --from=cp-deploy /app/out /app
EXPOSE 4000
CMD ["node", "dist/index.js"]

# ── Sticker Renderer Runtime ──
FROM builder AS sr-deploy
RUN pnpm --filter @skerry/sticker-renderer --prod deploy /app/out

FROM node:20-bookworm-slim AS sticker-renderer
WORKDIR /app
RUN apt-get update && apt-get install -y ffmpeg python3 python3-pip python3-venv build-essential cmake python3-dev && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN /opt/venv/bin/pip install --upgrade pip wheel setuptools && \
    /opt/venv/bin/pip install "rlottie-python[full]"

COPY --from=sr-deploy /app/out /app
EXPOSE 3000
CMD ["node", "dist/index.js"]
