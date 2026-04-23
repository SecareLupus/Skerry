# Base stage for pnpm and shared dependencies
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.12.2
COPY . /app
WORKDIR /app

# --- Build stage ---
FROM base AS build
ARG NEXT_PUBLIC_BASE_DOMAIN
# Create a .env file for the build to ensure Next.js picks it up.
RUN echo "NEXT_PUBLIC_BASE_DOMAIN=${NEXT_PUBLIC_BASE_DOMAIN:-localhost}" > .env && \
    pnpm install --frozen-lockfile && \
    pnpm run build

# --- Control Plane Runtime ---
FROM base AS control-plane
COPY --from=build /app /app
EXPOSE 4000
CMD [ "pnpm", "--filter", "@skerry/control-plane", "start:prod" ]

# --- Web App Runtime ---
FROM base AS web
COPY --from=build /app /app
EXPOSE 3000
CMD [ "pnpm", "--filter", "@skerry/web", "start:prod" ]

# --- Sticker Renderer Runtime ---
FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS sticker-renderer
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.12.2
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
COPY --from=build /app /app
RUN pnpm install --filter @skerry/sticker-renderer
# We don't need to install playwright browsers because they are pre-installed in the base image
EXPOSE 3000
CMD [ "pnpm", "--filter", "@skerry/sticker-renderer", "start" ]
