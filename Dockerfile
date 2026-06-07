# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Stage 1 — build the SPA bundle.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend-build
WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# Output: /build/dist

# ---------------------------------------------------------------------------
# Stage 2 — backend runtime. One uvicorn process serves the SPA + songbird's API.
# songbird makes no outbound calls except to Concord (a runtime HTTP dependency);
# the container must be able to reach CONCORD_BASE_URL.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# gosu: drop from root to an unprivileged user after chowning the data dir.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 --shell /bin/bash songbird

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /build/dist ./frontend-dist

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data && chown songbird:songbird /data

# COOKIE_SECURE=false suits the default LAN-HTTP deploy; set it to 1/true when TLS
# fronts songbird, so the session cookie carries the Secure flag (see docs/SECURITY.md).
ENV DATA_DIR=/data \
    FRONTEND_DIST_DIR=/app/frontend-dist \
    CONCORD_BASE_URL=http://localhost:8000 \
    PORT=8077 \
    BIND_HOST=0.0.0.0 \
    COOKIE_SECURE=false

EXPOSE 8077

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "songbird.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8077"]
