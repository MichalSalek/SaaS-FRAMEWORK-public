#!/usr/bin/env bash
# gallery-junction-mapper.sh — keep the color/trait junction → DTO mapping a SSOT.
#
# INTENT:
#   The GalleryRecord.colors/.traits junction rows are mapped to the public
#   color/trait DTO shape ({id,name,hex_code} / {id,name,category,icon_url,
#   is_featured}) in exactly ONE place: mapGalleryColors / mapGalleryTraits in
#   web-1/src/domain/gallery/gallery.utils.api.ts, fed by the shared
#   GALLERY_COLORS_TRAITS_SELECT. This mapper + its select-fragment used to be
#   copy-pasted 1:1 across SIX gallery query ops (explore/list/detail/public/
#   update/paired-client) — adding a field to the color/trait DTO meant editing
#   6 sites (drift-vector). Consolidated to the shared helper (turbo-review S63).
#   The mapper is CROSS-DOMAIN: favorites (getFavoriteRecords_IO) was a 7th
#   consumer that re-inlined the same select+map, missed by S63 because this
#   guard only scanned gallery/ — the scan now covers ALL of web-1/src/domain
#   so no sibling domain can silently regrow the dup (turbo-review S64).
#
# RULE (structural, no counters/baselines — nothing here rots):
#   The inline-mapper tell is a direct read of a junction-only leaf field
#   (`.color.hex_code` or `.trait.is_featured`) — these appear ONLY when a caller
#   hand-maps the junction instead of calling mapGalleryColors/mapGalleryTraits.
#   ANY such read under web-1/src/domain/ OUTSIDE gallery.utils.api.ts is a
#   VIOLATION (re-inlined mapper → duplication regrown), UNLESS an explanatory
#   opt-out comment `gallery-mapper-allow: <reason>` sits on the same line
#   (e.g. a deliberately REDUCED projection like the GDPR data export, which
#   omits id/icon_url/is_featured and must NOT use the fuller SSOT mapper).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAN_DIR="$ROOT/web-1/src/domain"
UTILS_REL="gallery.utils.api.ts"

# The junction-only leaf fields that betray a hand-rolled junction mapper.
PATTERN='\.color\.hex_code|\.trait\.is_featured'

violations=$(grep -rEn "$PATTERN" "$SCAN_DIR" --include='*.ts' 2>/dev/null \
  | grep -v "/$UTILS_REL:" \
  | grep -v 'gallery-mapper-allow:' || true)

if [[ -n "$violations" ]]; then
  echo "✗ gallery-junction-mapper: inline color/trait junction mapping detected"
  echo "  Use mapGalleryColors/mapGalleryTraits + GALLERY_COLORS_TRAITS_SELECT"
  echo "  from web-1/src/domain/gallery/gallery.utils.api.ts (SSOT) instead of"
  echo "  re-inlining the mapper in ANY web-1/src/domain/ op. Escape with a"
  echo "  same-line 'gallery-mapper-allow: <reason>' for a deliberate reduced shape."
  echo "----------------------------------------"
  echo "$violations"
  exit 1
fi

echo "✓ gallery-junction-mapper: color/trait junction mapping stays SSOT (gallery.utils.api.ts)"
exit 0
