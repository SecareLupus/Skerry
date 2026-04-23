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
FROM node:20-bookworm-slim AS sticker-renderer
RUN apt-get update && apt-get install -y ffmpeg python3 python3-pip python3-venv build-essential cmake python3-dev && rm -rf /var/lib/apt/lists/*

# Use a virtual environment for python
RUN python3 -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install rlottie-python using absolute path and verify
RUN /opt/venv/bin/pip install --upgrade pip wheel setuptools && \
    /opt/venv/bin/pip install "rlottie-python[full]" && \
    /opt/venv/bin/python3 -c "import rlottie; print('Import worked!')"

RUN npm install -g pnpm@9.12.2
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
COPY --from=build /app /app
RUN pnpm install --filter @skerry/sticker-renderer
EXPOSE 3000
CMD [ "pnpm", "--filter", "@skerry/sticker-renderer", "start" ]
