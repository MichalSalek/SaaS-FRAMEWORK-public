#!/usr/bin/env bash
# asset-ownership-gate.sh — Every domain file that PERSISTS a Cloudinary
# `public_id` must pass the incoming address through the shared ownership gate
# `findForeignAssetOwner` (web-1/src/domain/_shared/guards/cloudinary-asset.guard.ts),
# or say in a comment why it does not have to.
#
# INTENT:
#   The upload goes from the BROWSER straight to Cloudinary, so the backend only
#   ever receives an ADDRESS. The kernel validator confirms nothing more than
#   "this points at our CDN" (`isCloudinaryAssetUrl`) — a domain prefix. But the
#   irreversible side effect (deleting the blob) runs on the `public_id` DERIVED
#   from that address, and one `public_id` has unboundedly many spellings. So a
#   surface that stores a client-supplied address without the ownership gate lets
#   any stylist point a row of her own at SOMEBODY ELSE'S file.
#
# WHY A GUARD AND NOT A TEST OR A TYPE:
#   Nothing mechanical sees this today. The address is a plain `string`, so no
#   type can carry "already checked"; tsc and ESLint accept the ungated write;
#   and a unit test only ever covers the surface somebody remembered to write one
#   for — which is precisely the surface that already has the gate. The failure is
#   SILENT: the ungated write succeeds, looks completely normal, and only shows up
#   as somebody else's photo in a portfolio.
#
# WHY IT EXISTS AT ALL — THIRD OCCURRENCE OF ONE CLASS:
#   1. Visit result photos (2026-09): `asset_url` taken from the client and checked
#      by domain prefix only — confirmed in runtime that a stylist could attach a
#      photo from a FOREIGN public gallery to her own visit and then, by deleting
#      it, destroy the other account's file in the cloud. The gate was born here as
#      a private function.
#   2. Stylist avatar (2026-09-09): the same vector on a second surface; the gate
#      was lifted into `_shared/guards` precisely so the control would stop being
#      copied per surface.
#   3. Gallery create (2026-09-16, this guard): the surface that is both the
#      LARGEST and the SOURCE of the addresses for the other two — a public profile
#      prints `asset_url` straight into the HTML — was the only one still ungated.
#      Both DECISION comments already said the gate covered "EVERY surface"; prose
#      does not block a push, and the header listing two surfaces while claiming
#      all of them is exactly how the third one stayed invisible. This does block.
#
# WHAT IT FLAGS:
#   A file under `web-1/src/domain/` (excluding `*.test.ts`) that mentions a
#   `public_id:` / `avatar_public_id:` key in a Prisma payload but never calls
#   `findForeignAssetOwner(`.
#
# WHAT IT ALLOWS:
#   - The gate file itself (it DEFINES `findForeignAssetOwner`, so it matches).
#   - `// asset-ownership-allow: <reason>` anywhere in the file. The reason is
#     MANDATORY — a bare marker is itself a violation, because an escape nobody had
#     to justify is how a ratchet rots into decoration. Today's legitimate holders
#     are the demo-seed files: they compose addresses from their OWN photo bank,
#     never from request input, and cannot run outside dev/staging.
#
# HONEST SCOPE (what this does NOT prove):
#   Per-file, textual, and presence-only: it proves the gate is CALLED in the file,
#   not that it is called on the right variable or before the write. A surface that
#   stores an address under some future column name other than `public_id` is a
#   false negative. It measures the rule "a file that persists a cloud file id has
#   consulted the ownership gate" — which is the step that was actually missed
#   three times — not the correctness of the call.
#
# SCOPE: web-1/src/domain (*.ts, excluding *.test.ts). Comment-aware: the scan runs
#   on stripped code, so the DECISION prose quoting these key names does not trip
#   the guard, while the allow-marker is read from the ORIGINAL text.
#
# EXIT: 0 if PASS, 1 if an ungated writer exists.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
DOMAIN_DIR="${ROOT}/web-1/src/domain"
GATE_FILE="${DOMAIN_DIR}/_shared/guards/cloudinary-asset.guard.ts"

print_boxed_header "Asset ownership gate: no ungated Cloudinary public_id writer" "🔐"

require_source_dir "${DOMAIN_DIR}" "web-1 domain sources" "ts"

# Every path literal this guard leans on must exist — an assertion anchored on a
# moved file exempts nothing and silently stops measuring (S113).
if [[ ! -f "${GATE_FILE}" ]]; then
  print_error "Gate file missing: ${GATE_FILE#"${ROOT}/"}"
  print_info "The shared gate moved or was deleted — update this guard's anchor before trusting it."
  exit 1
fi

print_header "Scanning domain writers of a Cloudinary public_id"

VIOLATIONS=0
WRITER_SITES=0
WRITER_FILES=0
ALLOWED_FILES=0

while IFS= read -r file; do
  # The gate file itself DEFINES the rule and queries those columns in WHERE
  # clauses; excluded BY PATH, never by "it happens to mention its own name" —
  # that would silently stop excluding it the day the definition is reformatted.
  [[ "$file" == "${GATE_FILE}" ]] && continue

  # DECISION (nie usuwaj tego komentarza) — ZDEJMUJEMY KOMENTARZE RAZ, A PUSTY WYNIK
  # NAD NIEPUSTYM PLIKIEM JEST BLEDEM, NIE WERDYKTEM:
  # `strip_comments_keep_lines` odpala perla na plik, a ten straznik wolal go TRZY RAZY
  # na kazdy plik. `run-all.sh` puszcza ponad sto audytow ROWNOLEGLE, wiec przy pechowym
  # obciazeniu perl potrafi nie wystartowac — wtedy strip zwraca PUSTO, `grep -q
  # 'findForeignAssetOwner('` nie znajduje wywolania i straznik oglasza naruszenie nad
  # plikiem, ktory bramke wola poprawnie. Dokladnie ta klasa co w S87: „nie umiem zmierzyc"
  # zostaje pomylone z „nie dziala", a koszt to falszywa CZERWIEN blokujaca push.
  # Zaobserwowane na zywo 2026-09-16: `gallery-create.operation.ts` raportowane jako
  # niebramkowane w jednym przebiegu rownoleglym, zielone w trzech przebiegach osobno.
  # Dlatego: jeden strip na plik (3x mniej procesow) + twarda asercja mierzalnosci.
  stripped=$(strip_comments_keep_lines "$file" || true)
  if [[ -z "$stripped" && -s "$file" ]]; then
    print_error "Nie udalo sie zdjac komentarzy z ${file#"${ROOT}/"} — audyt NIE zgaduje werdyktu"
    echo "  Pusty wynik nad niepustym plikiem znaczy 'nie zmierzylem', a nie 'brak bramki'." >&2
    exit 1
  fi

  # Match sites are counted on CODE, never on prose: `legacy-code` once punished a
  # comment explaining its own exception, so the floor here counts real keys only.
  sites=$(printf '%s\n' "$stripped" \
    | grep -cE '(^|[^a-z_])(avatar_)?public_id[[:space:]]*:' || true)
  [[ "$sites" -eq 0 ]] && continue

  WRITER_SITES=$((WRITER_SITES + sites))
  WRITER_FILES=$((WRITER_FILES + 1))

  # grep exits at the first match; a pipe can then SIGPIPE printf on large files
  # and turn a successful match into a violation under pipefail.
  if grep -q 'findForeignAssetOwner(' <<< "$stripped"; then
    continue
  fi

  # The escape is read from the ORIGINAL text (it lives in a comment), and a bare
  # marker with no reason after the colon does not count as one.
  if grep -qE 'asset-ownership-allow:[[:space:]]*[^[:space:]]' "$file"; then
    ALLOWED_FILES=$((ALLOWED_FILES + 1))
    continue
  fi

  rel="${file#"${ROOT}/"}"
  print_error "${rel} — persists a Cloudinary public_id without calling findForeignAssetOwner()"
  printf '%s\n' "$stripped" \
    | grep -nE '(^|[^a-z_])(avatar_)?public_id[[:space:]]*:' \
    | sed 's/^/      /'
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(find "${DOMAIN_DIR}" -type f -name '*.ts' ! -name '*.test.ts' | sort)

# Presence floor on the MATCH SITES, not on the file count: a rename of the column
# would take this to zero and every future run would glow green over nothing.
require_scanned "${WRITER_SITES}" "Cloudinary public_id write sites in web-1/src/domain"

if [[ "${VIOLATIONS}" -gt 0 ]]; then
  print_separator
  print_error "${VIOLATIONS} file(s) store a cloud file id without the ownership gate"
  print_info "Fix: call findForeignAssetOwner(<address>, <accountId>) and reject anything other than 'OWN'"
  print_info "     (reference call sites: gallery-create.operation.ts, visit-result-photo.operations.ts, account-avatar.operations.ts)"
  print_info "Deliberate exception: // asset-ownership-allow: <reason>  (the reason is mandatory)"
  exit 1
fi

print_success "${WRITER_SITES} public_id write site(s) across ${WRITER_FILES} file(s) — all gated (${ALLOWED_FILES} with a documented exception)"
exit 0
