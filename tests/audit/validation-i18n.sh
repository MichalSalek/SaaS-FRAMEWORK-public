#!/usr/bin/env bash
# validation-i18n.sh — Guard against hardcoded (non-i18n) message string literals
# returned from kernel validators.
#
# INTENT:
#   .shared-kernel/domain/i18n/validation.i18n.ts (VALIDATION_MESSAGES, aliased `V`)
#   is the SSOT for validation error message KEYS. Validators must accumulate i18n
#   keys (e.g. `returnObject.field += V.section.key + ' '`) — NEVER raw English
#   sentences. A raw literal bypasses i18n: a PL/DE user receives an English message
#   that no translation layer can localize (the key→common.json resolution never
#   fires because there is no key).
#
# WHAT IT CHECKS:
#   In every .shared-kernel/policies/validation/*.ts source file, any
#   `returnObject.<field> +=` whose right-hand side is a raw string/template literal
#   beginning with an alphabetic character (a human-readable word) — instead of a
#   `V.*` key reference — is a violation. Both same-line and multi-line
#   (`+=` then newline then the literal) forms are detected.
#
# ALLOWLIST:
#   Technical, non-user-facing accumulators that are never surfaced to end users
#   (none currently — all validator messages must be i18n keys).
#
# EXIT: 0 if PASS (no raw literals), 1 if violations found.
#
# DECISION (nie usuwaj tego komentarza): zakres CELOWO wąski — tylko legacy wzorzec
# akumulatora `returnObject.<field> += 'literal'`. Po migracji na zod (FWE Wave H) ten
# wzorzec jest niemal wymarły, więc .sh działa jak tani STATYCZNY regression-guard w gate
# push-time (vitest NIE jest w gate push). Pełną fidelity i18n bieżących walidatorów zod
# (każdy token błędu = klucz `validation.*`, zero gołych zod-defaultów) pilnuje mocniejszy,
# runtime-fuzzujący test: web-1/src/test-utils/kernel-policies/validation/validation-i18n-fidelity.test.ts.
# NIE rozszerzać tego grepa na formy zod (`message:`, `.refine`, `.min(N,'...')`): generyczne
# `message:` dawało false-positive, a i tak nie pokrywało callbacków `error: () => ...`.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
VALIDATION_DIR="${ROOT}/.shared-kernel/policies/validation"

print_boxed_header "Validation i18n: no hardcoded message literals" "🌐"

if [[ ! -d "$VALIDATION_DIR" ]]; then
  print_error "Validation source dir not found at ${VALIDATION_DIR}"
  exit 1
fi

# Allowlist — relative paths (from ROOT) exempt from the check.
# Reserved for genuinely technical, non-user-facing accumulators.
ALLOWLIST=()

VIOLATIONS=0

# A violation is `returnObject.<field> +=` whose right-hand side is a raw string /
# template literal that STARTS with an alphabetic character (a human-readable word) —
# instead of a `V.*` key reference. The leading-letter requirement is what separates a
# hardcoded English sentence ("instagram_handle must be...") from concatenation glue
# (`+ ' '`) or a `V.section.key` identifier (not a quoted literal).
#
# Two forms are detected:
#   (a) same-line:   returnObject.x += 'Word...'   or   += `Word...`
#   (b) multi-line:  returnObject.x +=   ⏎   'Word...'
# Quote chars covered: '  "  `
SAME_LINE_PCRE='returnObject\.[A-Za-z_][A-Za-z0-9_]*\s*\+=\s*['"'"'"`][A-Za-z]'

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  SKIP=0
  for allowed in "${ALLOWLIST[@]:-}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  # (a) same-line hits — accurate line numbers via grep -n.
  SAME_LINE_HITS=$(grep -nP "$SAME_LINE_PCRE" "$file" 2>/dev/null | cut -d: -f1 || true)

  # (b) multi-line hits — anchor line is `returnObject.x +=` at EOL whose next
  # non-empty line opens with a quote + letter. awk reports the ANCHOR line number.
  MULTI_LINE_HITS=$(awk '
    /returnObject\.[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\+=[[:space:]]*$/ { anchor=NR; pending=1; next }
    pending==1 {
      if ($0 ~ /^[[:space:]]*['"'"'"`][A-Za-z]/) print anchor
      pending=0
    }
  ' "$file" || true)

  HITS=$( { printf '%s\n%s\n' "$SAME_LINE_HITS" "$MULTI_LINE_HITS" | grep -E '^[0-9]+$' | sort -un | tr '\n' ',' | sed 's/,$//'; } || true )

  if [[ -n "$HITS" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — ${REL_PATH} at line(s): ${HITS}"
    print_info  "  Fix: return a V.<section>.<key> i18n key, not a raw English literal"
  fi
done < <(find "$VALIDATION_DIR" -maxdepth 1 -type f -name "*.ts" -print0)

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "validation-i18n audit FAILED — ${VIOLATIONS} file(s) with hardcoded message literals"
  print_info  "Every validator message must be a V.* key from validation.i18n.ts (translated in common.json ×3 langs)."
  echo ""
  exit 1
fi

print_success "validation-i18n audit PASSED — all validator messages use i18n keys"
exit 0
