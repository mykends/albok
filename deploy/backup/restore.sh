#!/bin/sh
# Restore a backup made by backup.sh. Run on the server from the deploy/ folder:
#   sh backup/restore.sh 2026-10-20
# Stops the API, replaces the database and the files volume, then starts everything again.
set -eu
stamp="${1:?Usage: sh backup/restore.sh YYYY-MM-DD}"
dir="${BACKUP_DIR:-./backups}"
[ -f "$dir/albok-$stamp.dump" ] || { echo "Missing $dir/albok-$stamp.dump"; exit 1; }
[ -f "$dir/albok-files-$stamp.tar.gz" ] || { echo "Missing $dir/albok-files-$stamp.tar.gz"; exit 1; }

docker compose stop api web
docker compose run --rm --no-deps -v "$(cd "$dir" && pwd):/restore:ro" --entrypoint sh backup -c \
  "pg_restore --clean --if-exists --no-owner --dbname=albok /restore/albok-$stamp.dump"
docker compose run --rm --no-deps -v "$(cd "$dir" && pwd):/restore:ro" --entrypoint sh api -c \
  "find /data -mindepth 1 -delete && tar -xzf /restore/albok-files-$stamp.tar.gz -C /data"
docker compose up -d
echo "Restored $stamp."
