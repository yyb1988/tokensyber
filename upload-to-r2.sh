#!/bin/bash
# Upload all 29 compressed GLB models + display images + manifest to R2
# Usage: bash upload-to-r2.sh [--dry-run]

set -e
DRY_RUN=false
[ "$1" = "--dry-run" ] && DRY_RUN=true && echo "=== DRY RUN ==="

BUCKET="tokensyber-models"
COUNTER=0
TOTAL=29

echo "Uploading $TOTAL models to R2 bucket: $BUCKET"

# Read manifest and upload each model file
# Using node to parse manifest and print file paths
node -e "
const m = require('./models/manifest.json');
m.forEach(e => console.log(e.file + '|' + e.displayImage));
" | while IFS='|' read -r glb_file display_image; do
  COUNTER=$((COUNTER + 1))
  IDX="$COUNTER/$TOTAL"

  # Upload GLB
  if [ -f "$glb_file" ]; then
    SIZE=$(stat -c%s "$glb_file" 2>/dev/null || stat -f%z "$glb_file" 2>/dev/null)
    SIZE_MB=$(echo "scale=1; $SIZE/1048576" | bc 2>/dev/null || echo "?")
    echo "[$IDX] $glb_file (${SIZE_MB}MB)"

    if [ "$DRY_RUN" = false ]; then
      npx wrangler r2 object put "$BUCKET/$glb_file" \
        --file="$glb_file" \
        --ct=model/gltf-binary \
        --cache-control "public, max-age=31536000, immutable" 2>&1 | tail -1
    fi
  else
    echo "[$IDX] SKIP $glb_file - not found"
  fi

  # Upload display image
  if [ -f "$display_image" ]; then
    if [ "$DRY_RUN" = false ]; then
      npx wrangler r2 object put "$BUCKET/$display_image" \
        --file="$display_image" \
        --ct=image/jpeg \
        --cache-control "public, max-age=31536000, immutable" 2>&1 | tail -1
    fi
  fi
done

# Upload manifest
echo "Uploading manifest.json..."
if [ "$DRY_RUN" = false ]; then
  npx wrangler r2 object put "$BUCKET/models/manifest.json" \
    --file=models/manifest.json \
    --ct=application/json \
    --cache-control "public, max-age=3600" 2>&1 | tail -1
fi

echo ""
echo "Done! $COUNTER/$TOTAL models uploaded."
echo "Public URL: https://pub-32c2ddcfcf824086b7a3ff0cd0c0aa78.r2.dev/"
