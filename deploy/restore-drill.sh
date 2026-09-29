#!/usr/bin/env bash
set -euo pipefail
umask 077

config_file=${BACKUP_CONFIG:-/etc/umi-consent-delivery/backup.env}
[[ -f "$config_file" ]] || { echo "Backup configuration is missing" >&2; exit 1; }
# shellcheck source=/dev/null
source "$config_file"
: "${BACKUP_SSH_HOST:?Set BACKUP_SSH_HOST}"
: "${BACKUP_REMOTE_DIR:?Set BACKUP_REMOTE_DIR}"
BACKUP_REPO_ROOT=${BACKUP_REPO_ROOT:-/opt/umi-consent-delivery}
BACKUP_ROOT=${BACKUP_ROOT:-/srv/umi-consent-delivery/backups}
BACKUP_PUBLIC_KEY=${BACKUP_PUBLIC_KEY:-/etc/umi-consent-delivery/public.pem}
[[ "$BACKUP_SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@-]*$ ]] || { echo "Invalid SSH host" >&2; exit 1; }
[[ "$BACKUP_REMOTE_DIR" =~ ^/[a-zA-Z0-9._/-]+$ && "$BACKUP_REMOTE_DIR" != / && "$BACKUP_REMOTE_DIR" != *..* ]] || { echo "Invalid remote directory" >&2; exit 1; }
[[ -x "$BACKUP_REPO_ROOT/deploy/ops.sh" && -f "$BACKUP_PUBLIC_KEY" ]] || { echo "Operations runner or public key is missing" >&2; exit 1; }
[[ "$BACKUP_ROOT" == /srv/umi-consent-delivery/* && "$BACKUP_PUBLIC_KEY" == /etc/umi-consent-delivery/public.pem ]] || { echo "Backup paths are outside production mounts" >&2; exit 1; }

mkdir -p "$BACKUP_ROOT/drills"
exec 9>"$BACKUP_ROOT/.backup.lock"
flock -n 9 || { echo "Another backup or restore drill is running" >&2; exit 1; }

mapfile -t saved < <(find "$BACKUP_ROOT/snapshots" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
[[ ${#saved[@]} -gt 0 && ${saved[0]} =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "No daily snapshot to restore" >&2; exit 1; }
drill="$BACKUP_ROOT/drills/$(date -u +%Y%m%dT%H%M%SZ)"
download=$(mktemp -d "$BACKUP_ROOT/drills/.download-XXXXXXXX")
trap 'rm -rf -- "$download"' EXIT

stamp=${saved[0]}
marker=.umi-consent-delivery-backups
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$BACKUP_SSH_HOST" "test -f '$BACKUP_REMOTE_DIR/$marker'" || {
  echo "Remote backup marker is missing" >&2
  exit 1
}
rsync -a -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes' -- "$BACKUP_SSH_HOST:$BACKUP_REMOTE_DIR/$stamp.tar.gz" "$download/"
rsync -a -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes' -- "$BACKUP_SSH_HOST:$BACKUP_REMOTE_DIR/$stamp.tar.gz.sha256" "$download/"
cmp "$BACKUP_ROOT/archives/$stamp.tar.gz.sha256" "$download/$stamp.tar.gz.sha256"
(cd "$download" && sha256sum -c "$stamp.tar.gz.sha256")
python3 "$BACKUP_REPO_ROOT/deploy/extract-snapshot.py" "$download/$stamp.tar.gz" "$download/extracted" "$stamp"
"$BACKUP_REPO_ROOT/deploy/ops.sh" verify "$download/extracted/$stamp" "$BACKUP_PUBLIC_KEY"
"$BACKUP_REPO_ROOT/deploy/ops.sh" restore "$download/extracted/$stamp" "$drill" "$BACKUP_PUBLIC_KEY"
"$BACKUP_REPO_ROOT/deploy/ops.sh" verify "$drill" "$BACKUP_PUBLIC_KEY"

mapfile -t drills < <(find "$BACKUP_ROOT/drills" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
for ((i=4; i<${#drills[@]}; i++)); do
  old=${drills[$i]}
  [[ "$old" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "Unexpected drill name" >&2; exit 1; }
  rm -rf -- "$BACKUP_ROOT/drills/$old"
done
echo "Verified restore drill $drill"
