#!/usr/bin/env bash
set -euo pipefail
umask 077

config_file=${BACKUP_CONFIG:-/etc/umi-consent-delivery/backup.env}
[[ -f "$config_file" ]] || { echo "Backup configuration is missing" >&2; exit 1; }
# This file is root-owned and contains deployment paths, not installation tokens.
# shellcheck source=/dev/null
source "$config_file"

: "${BACKUP_SSH_HOST:?Set BACKUP_SSH_HOST}"
: "${BACKUP_REMOTE_DIR:?Set BACKUP_REMOTE_DIR}"
BACKUP_REPO_ROOT=${BACKUP_REPO_ROOT:-/opt/umi-consent-delivery}
BACKUP_DATA_DIR=${BACKUP_DATA_DIR:-/srv/umi-consent-delivery/data}
BACKUP_ROOT=${BACKUP_ROOT:-/srv/umi-consent-delivery/backups}
BACKUP_PUBLIC_KEY=${BACKUP_PUBLIC_KEY:-/etc/umi-consent-delivery/public.pem}
BACKUP_KEEP_DAILY=${BACKUP_KEEP_DAILY:-14}

[[ "$BACKUP_SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@-]*$ ]] || { echo "Invalid SSH host" >&2; exit 1; }
[[ "$BACKUP_REMOTE_DIR" =~ ^/[a-zA-Z0-9._/-]+$ && "$BACKUP_REMOTE_DIR" != / && "$BACKUP_REMOTE_DIR" != *..* ]] || { echo "Invalid remote directory" >&2; exit 1; }
[[ "$BACKUP_KEEP_DAILY" =~ ^[0-9]+$ ]] && (( BACKUP_KEEP_DAILY >= 1 && BACKUP_KEEP_DAILY <= 365 )) || { echo "Invalid retention" >&2; exit 1; }
[[ -f "$BACKUP_REPO_ROOT/build/src/operations.js" && -f "$BACKUP_PUBLIC_KEY" ]] || { echo "Operations build or public key is missing" >&2; exit 1; }

snapshots="$BACKUP_ROOT/snapshots"
archives="$BACKUP_ROOT/archives"
mkdir -p "$snapshots" "$archives"
exec 9>"$BACKUP_ROOT/.backup.lock"
flock -n 9 || { echo "Another backup or restore drill is running" >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot="$snapshots/$stamp"
archive="$archives/$stamp.tar.gz"
[[ ! -e "$snapshot" && ! -e "$archive" ]] || { echo "Backup name already exists" >&2; exit 1; }

node "$BACKUP_REPO_ROOT/build/src/operations.js" backup "$BACKUP_DATA_DIR" "$snapshot" "$BACKUP_PUBLIC_KEY"
node "$BACKUP_REPO_ROOT/build/src/operations.js" verify "$snapshot" "$BACKUP_PUBLIC_KEY"
tar -C "$snapshots" -czf "$archive" "$stamp"
(cd "$archives" && sha256sum "$stamp.tar.gz" > "$stamp.tar.gz.sha256")

marker=.umi-consent-delivery-backups
printf 'umi-consent-delivery backups\n' > "$archives/$marker"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$BACKUP_SSH_HOST" "test -f '$BACKUP_REMOTE_DIR/$marker'" || {
  echo "Remote backup marker is missing; refusing transfer" >&2
  exit 1
}
rsync -a -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes' -- "$archive" "$archive.sha256" "$BACKUP_SSH_HOST:$BACKUP_REMOTE_DIR/"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$BACKUP_SSH_HOST" "cd '$BACKUP_REMOTE_DIR' && sha256sum -c '$stamp.tar.gz.sha256'"

mapfile -t saved < <(find "$snapshots" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
for ((i=BACKUP_KEEP_DAILY; i<${#saved[@]}; i++)); do
  old=${saved[$i]}
  [[ "$old" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "Unexpected snapshot name" >&2; exit 1; }
  rm -rf -- "$snapshots/$old"
  rm -f -- "$archives/$old.tar.gz" "$archives/$old.tar.gz.sha256"
done

# The marker guards --delete against an accidental target change.
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$BACKUP_SSH_HOST" "test -f '$BACKUP_REMOTE_DIR/$marker'"
rsync -a --delete -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes' -- "$archives/" "$BACKUP_SSH_HOST:$BACKUP_REMOTE_DIR/"
echo "Verified backup $stamp; retained up to $BACKUP_KEEP_DAILY daily snapshots"
