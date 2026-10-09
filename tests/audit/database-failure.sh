#!/usr/bin/env bash
# database-failure.sh — Guard the single DB-error idiom in web-1/src/domain.
#
# INTENT:
#   `databaseFailure(operation, error)` (web-1/src/application/errors/error-result.helpers.ts)
#   is the SINGLE SOURCE OF TRUTH for the "a Prisma call threw" failure path. It does
#   three things in one place: (1) reportIssueBackend breadcrumb with message+stack,
#   (2) preserves observability (stack/cause logged server-side, never leaked), and
#   (3) returns the canonical failure({ type: 'DATABASE_ERROR', operation }) that the
#   error-mapper maps to HTTP 500 + APPLICATION.GENERAL_ERROR (opaque).
#
#   Two anti-patterns it replaces (BDX W3.2 census):
#     (a) swallowed `catch {}` (no error binding) → inline DATABASE_ERROR failure.
#         Loses the stack/log entirely — a REAL observability bug.
#     (b) `catch (error) { reportIssueBackend(...); return failure({ DATABASE_ERROR }) }`
#         — observability OK, but a SECOND hand-rolled idiom that drifts (namespace
#         typos, missing stack, inconsistent payload shape).
#
# WHAT IT CHECKS (scope = web-1/src/domain, the census scope):
#   A `catch (<errvar>) { ... }` block whose body contains an inline
#   `type: 'DATABASE_ERROR'` literal but does NOT route through `databaseFailure(`
#   = VIOLATION. Inside a catch the error IS in scope, so there is never a reason to
#   hand-roll the failure — pass it to databaseFailure() instead.
#
#   NOT flagged (correct by construction — no error in scope, not a catch idiom):
#     - inline DATABASE_ERROR at function-body scope (logic fallthrough / "should not
#       happen" / post-write narrowing failure) — no error variable to forward.
#     - inline DATABASE_ERROR in an input-validation guard (e.g. `if (!id)`).
#     - swallowed `catch {}` WITHOUT a binding is impossible to forward; but after
#       W3.2 every census catch binds `error`, so a re-introduced bare `catch {}` +
#       inline DATABASE_ERROR would simply land at function scope (still flagged only
#       if a binding exists). The RED-FIRST proof below exercises a real binding.
#
# ALLOWLIST — intentional second-idiom (jawny DECISION, custom payload needed):
#   - support/operations/support-admin-error.helper.ts — `supportDbFailure()` helper
#     DELIBERATELY keeps a support-specific namespace (e.g. SUPPORT_ADMIN_REPLY_ERROR)
#     + thread context (threadId/status) in the payload instead of the generic
#     DATABASE_ERROR+stack, to trace a concrete thread in the logs. Documented DECISION
#     in the file header. It already binds `error` + calls reportIssueBackend
#     (observability preserved) — collapsing it would lose that context.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
DOMAIN_DIR="${ROOT}/web-1/src/domain"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$DOMAIN_DIR" "domeny web-1"

print_boxed_header "Database failure: single-idiom enforcement" "🗄️"

# Allowlist — paths (relative to ROOT) exempt from the catch-block check.
ALLOWLIST=(
  "web-1/src/domain/support/operations/support-admin-error.helper.ts"
)

VIOLATIONS=0
VIOLATION_DETAIL=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  SKIP=0
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  # Fast pre-filter: only files that even contain a DATABASE_ERROR literal.
  grep -q "type: 'DATABASE_ERROR'" "$file" 2>/dev/null || continue

  # awk: walk catch-blocks with a binding. Track brace depth from the catch's
  # opening `{`. Inside the block, note whether an inline DATABASE_ERROR literal
  # appears and whether databaseFailure( is used. On block close, a literal
  # without databaseFailure( = violation (report the catch's line).
  RESULT=$(awk '
    BEGIN { in_catch = 0; depth = 0; has_literal = 0; has_helper = 0; catch_line = 0 }

    # Enter a catch WITH a binding: catch (err) / catch (error: unknown) / catch(e)
    in_catch == 0 && /catch[[:space:]]*\([[:space:]]*[A-Za-z_]/ {
      in_catch = 1
      depth = 0
      has_literal = 0
      has_helper = 0
      catch_line = NR
      # Count braces ON this line FROM the catch keyword onward only. The common
      # shape "} catch (error) {" has a leading "}" closing the try block, which must
      # NOT decrement the catch depth, or a one-line "} catch (x) {" reads as
      # balanced (depth 0) and the body is skipped entirely.
      rest = $0
      sub(/^.*catch[[:space:]]*\(/, "", rest)
      n_open = gsub(/\{/, "{", rest)
      n_close = gsub(/\}/, "}", rest)
      depth += n_open - n_close
      # depth<=0 here means the catch body opened and closed on this same line
      # (true one-liner); nothing further to scan.
      if (depth <= 0) { in_catch = 0 }
      next
    }

    in_catch == 1 {
      if (index($0, "type: '\''DATABASE_ERROR'\''") > 0) { has_literal = 1 }
      if (index($0, "databaseFailure(") > 0) { has_helper = 1 }
      n_open = gsub(/\{/, "{")
      n_close = gsub(/\}/, "}")
      depth += n_open - n_close
      if (depth <= 0) {
        if (has_literal == 1 && has_helper == 0) {
          printf "%d\n", catch_line
        }
        in_catch = 0
      }
    }
  ' "$file")

  if [[ -n "$RESULT" ]]; then
    LINES=$(echo "$RESULT" | tr '\n' ',' | sed 's/,$//')
    VIOLATIONS=$((VIOLATIONS + 1))
    VIOLATION_DETAIL="${VIOLATION_DETAIL}${REL_PATH}:${LINES}"$'\n'
    print_error "VIOLATION — ${REL_PATH} (catch at line[s]: ${LINES})"
    print_info  "  A catch block hand-rolls failure({ type: 'DATABASE_ERROR' })."
    print_info  "  Fix: return databaseFailure('<operation>', error) — single idiom"
    print_info  "       (log + stack + correct DATABASE_ERROR shape in one place)."
  fi

done < <(find "$DOMAIN_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/\|\.test\.")

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "database-failure audit FAILED — ${VIOLATIONS} file(s) with a second-idiom DB failure"
  echo ""
  exit 1
fi

print_success "database-failure audit PASSED — all catch-block DB failures use databaseFailure()"
exit 0
