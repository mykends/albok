#!/bin/sh
# Nightly backup: a pg_dump of the database and a tarball of the files volume, kept BACKUP_KEEP_DAYS days.
# Runs inside the `backup` service. Restore with deploy/backup/restore.sh.
set -eu

run_backup() {
  stamp=$(date +%Y-%m-%d)
  echo "$(date) backup $stamp"
  pg_dump --format=custom --file="/backups/albok-$stamp.dump.tmp" && mv "/backups/albok-$stamp.dump.tmp" "/backups/albok-$stamp.dump"
  tar -czf "/backups/albok-files-$stamp.tar.gz.tmp" -C /data --exclude=./files/cache --exclude=./outbox . \
    && mv "/backups/albok-files-$stamp.tar.gz.tmp" "/backups/albok-files-$stamp.tar.gz"
  find /backups -name 'albok-*' -type f -mtime +"$BACKUP_KEEP_DAYS" -delete
}

if [ "${1:-}" = "now" ]; then
  run_backup
  exit 0
fi

while true; do
  if [ "$(date +%-H)" = "$BACKUP_HOUR" ] && [ ! -f "/backups/albok-$(date +%Y-%m-%d).dump" ]; then
    run_backup || echo "$(date) backup FAILED"
  fi
  sleep 600
done
