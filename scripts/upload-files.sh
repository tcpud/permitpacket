#!/usr/bin/env bash
# Uploads the packet and every map listed in the CSV to R2.
# Usage: scripts/upload-files.sh [--local]   (default uploads to Cloudflare)
#   Maps are read from data/maps/, the packet from data/packet/.
set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET="tahoe-cedars-permit-files"
TARGET="${1:---remote}"
CSV="${CSV:-data/parcels.csv}"

npx wrangler r2 object put "$BUCKET/packet/Tahoe-Cedars-Permit-Packet.pdf" \
  --file "data/packet/Tahoe-Cedars-Permit-Packet.pdf" --content-type application/pdf "$TARGET"

# MapFile is the 4th column; skip header
tail -n +2 "$CSV" | while IFS=, read -r apn num name mapfile; do
  mapfile="${mapfile%$'\r'}"
  [ -z "$mapfile" ] && continue
  if [ ! -f "data/maps/$mapfile" ]; then
    echo "MISSING: data/maps/$mapfile (APN $apn)"; continue
  fi
  npx wrangler r2 object put "$BUCKET/maps/$mapfile" \
    --file "data/maps/$mapfile" --content-type application/pdf "$TARGET"
done
