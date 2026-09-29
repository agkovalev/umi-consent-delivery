#!/usr/bin/env bash
set -euo pipefail

# Run filesystem operations with the image's exact Node/SQLite runtime. Only the
# public trust key is mounted; the offline signing key is never exposed here.
data_root=/srv/umi-consent-delivery
public_key=/etc/umi-consent-delivery/public.pem
[[ -d "$data_root" && -f "$public_key" ]] || { echo "Production data root or public key is missing" >&2; exit 1; }

docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --mount "type=bind,source=$data_root,target=$data_root" \
  --mount "type=bind,source=$public_key,target=$public_key,readonly" \
  umi-consent-delivery:0.1.0 node build/src/operations.js "$@"
