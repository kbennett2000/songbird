#!/usr/bin/env bash
#
# 1. chown the data dir to the songbird user (idempotent)
# 2. re-exec as the unprivileged songbird user
# 3. run Alembic migrations
# 4. exec the CMD (uvicorn) so SIGTERM from `docker stop` reaches it directly
#
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
RUN_AS="songbird"

if [[ "$(id -u)" -eq 0 ]]; then
    chown -R "${RUN_AS}:${RUN_AS}" "${DATA_DIR}"
    exec gosu "${RUN_AS}" "$0" "$@"
fi

echo "[entrypoint] running as $(id -un) (uid $(id -u))"
echo "[entrypoint] data dir: ${DATA_DIR}"
echo "[entrypoint] concord:  ${CONCORD_BASE_URL:-<unset>}"

echo "[entrypoint] running alembic migrations"
alembic upgrade head

echo "[entrypoint] starting: $*"
exec "$@"
