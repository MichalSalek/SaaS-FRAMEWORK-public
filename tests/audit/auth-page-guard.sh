#!/usr/bin/env bash
# auth-page-guard.sh — Guard against NEW unprotected pages under src/pages/app/**.
#
# INTENT (FDX FAZA 4 / W4.6):
#   The app has NO auth in its Next.js middleware: main/src/proxy.ts exists but
#   handles only CSP, redirects and crawler tracking, and never checks a
#   session. Route protection for the authenticated
#   surface (/app/**) is CLIENT-SIDE: every authenticated view mounts through
#   one of the canonical guard shells, and the BACKEND is the real security
#   boundary (every /api/v1/** route enforces auth/RBAC/account-state). The two
#   client guard shells are:
#
#     • AppLayout  (UI/layouts/AppLayout.tsx)
#         — carries useDesktopRedirectGuard + useRecoveryGuard + useAppRole.
#           Soft-deleted (RECOVERABLE/EXPIRED) users are redirected to /recover;
#           desktop non-admins are redirected to /get-app. The recovery guard is
#           the FRONTEND mirror of the backend account-state boundary (B3).
#     • AdminLayout / AdminPageLayout  (UI/layouts/AdminLayout.tsx)
#         — reads useAppRole and redirects a confirmed logged-in non-admin to
#           /app (defense-in-depth over the API 403).
#
#   Pages under pages/app/** are THIN SHELLS (~15 LOC): they delegate to a
#   feature component in UI/features/** that mounts the layout. So the guard
#   marker is rarely IN the page file — it lives in the imported feature
#   component (static `from '...'` import OR `dynamic(() => import('...'))`).
#   This audit follows that one level of indirection.
#
# WHAT IT CHECKS:
#   For every src/pages/app/**/*.tsx that is NOT an allowlisted public route,
#   a guard marker (AppLayout | AdminPageLayout | AdminLayout | useAppRole |
#   useRecoveryGuard | account-state) must be reachable EITHER directly in the
#   page file OR in one of the UI/features|layouts modules it imports. A page
#   with no reachable guard marker = a potentially unprotected authenticated
#   view → exit 1 + the offending list.
#
# ALLOWLIST — intentional NON-guarded pages under pages/app/** (NOT violations):
#   These render NO protected content of their own (pure client redirect stubs)
#   or are deliberately reachable pre-auth. Each MUST be a conscious decision.
#   Truly public flows (e.g. pairing claim) live OUTSIDE pages/app/ (under
#   pages/pairing/) and are not in scope here.
#
# EXIT: 0 if every in-scope page has a reachable guard, 1 otherwise.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
PAGES_DIR="${ROOT}/main/src/pages/app"

# Guard markers — presence of ANY one (in the page or a directly-imported
# UI/features|layouts module) means the view mounts through a guard shell.
GUARD_RE='AppLayout|AdminPageLayout|AdminLayout|useAppRole|useRecoveryGuard|account-state|AccountState'

# ── Allowlist: pages (path relative to ROOT) that are intentionally NOT behind
#    a client guard shell. Each is a documented, conscious decision.
ALLOWLIST=(
  # Pure client-side redirect stub: renders `null` and immediately router.replace()s
  # into the discovery feed (or /app when EXPLORE_ENABLED is off). Mounts no layout
  # and exposes no protected content — adding a guard shell would only flash chrome
  # before the redirect. The destination (/app/explore or /app) is itself guarded.
  "main/src/pages/app/stylists/index.tsx"
  # Permanent redirect stub: the activity timeline moved into the account page tab
  # (AccountActivityPanel, /app/user/account?tab=activity). This route renders `null`
  # and immediately router.replace()s there to keep old links/bookmarks alive. Mounts
  # no layout and exposes no protected content; the destination (account) is guarded.
  "main/src/pages/app/user/activity.tsx"
)

is_allowlisted() {
  local rel="$1"
  local allowed
  for allowed in "${ALLOWLIST[@]}"; do
    [[ "$rel" == "$allowed" ]] && return 0
  done
  return 1
}

# Resolve a TS module specifier (relative to a base dir) to the concrete source
# file(s) to scan for the guard marker. Echoes zero or more paths (newline-sep).
#
# A specifier may resolve to a FILE (Foo.tsx) or a DIRECTORY module. Directory
# modules are common here (feature components ship as a folder with a barrel
# `index.ts` re-exporting `./Foo` whose Foo.tsx carries the layout). The barrel
# itself has no guard marker, so for a directory module we scan EVERY .tsx/.ts
# directly inside it (one level) — the layout-mounting component lives there.
resolve_module_files() {
  local basedir="$1" spec="$2" target base cand
  target="$(cd "$basedir" && realpath -m "$spec" 2>/dev/null || true)"
  [[ -z "$target" ]] && return 0

  # Direct file forms (specifier already points at a file sans extension).
  for cand in "$target.tsx" "$target.ts"; do
    [[ -f "$cand" ]] && echo "$cand"
  done

  # Directory module: scan top-level .tsx/.ts inside it (barrel + component).
  if [[ -d "$target" ]]; then
    find "$target" -maxdepth 1 -type f \( -name "*.tsx" -o -name "*.ts" \) 2>/dev/null
  fi
}

# Extract UI/features|layouts module specifiers imported by a file (static
# `from '...'` and dynamic `import('...')`).
extract_ui_specifiers() {
  grep -oE "(from|import\()[[:space:]]*['\"][^'\"]*UI/(features|layouts)/[^'\"]*['\"]" "$1" 2>/dev/null \
    | grep -oE "['\"][^'\"]*UI/(features|layouts)/[^'\"]*['\"]" \
    | tr -d "'\""
}

# Returns 0 (guard reachable) / 1 (no guard) for a single page file.
page_has_guard() {
  local page="$1" pagedir spec modfile
  # 1) Direct marker in the page itself.
  if grep -qE "$GUARD_RE" "$page" 2>/dev/null; then
    return 0
  fi
  pagedir="$(dirname "$page")"
  # 2) Follow imports of UI/features|layouts modules, check each resolved module
  #    (file or directory-module sibling) for a guard marker.
  while IFS= read -r spec; do
    [[ -z "$spec" ]] && continue
    while IFS= read -r modfile; do
      [[ -z "$modfile" ]] && continue
      if grep -qE "$GUARD_RE" "$modfile" 2>/dev/null; then
        return 0
      fi
    done < <(resolve_module_files "$pagedir" "$spec")
  done < <(extract_ui_specifiers "$page")
  return 1
}

print_boxed_header "Auth page guard: /app/** protection census" "🔒"

if [[ ! -d "$PAGES_DIR" ]]; then
  print_error "Pages dir missing: ${PAGES_DIR#${ROOT}/}"
  exit 1
fi

print_header "Scanning src/pages/app/** for a reachable client guard shell"

VIOLATIONS=0
CHECKED=0
SKIPPED=0
UNPROTECTED=""

while IFS= read -r -d $'\0' page; do
  REL="${page#${ROOT}/}"

  if is_allowlisted "$REL"; then
    SKIPPED=$((SKIPPED + 1))
    print_info "ALLOWLIST (public/redirect): ${REL}"
    continue
  fi

  CHECKED=$((CHECKED + 1))
  if ! page_has_guard "$page"; then
    UNPROTECTED="${UNPROTECTED}${REL}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "NO GUARD REACHABLE: ${REL}"
    print_info  "  Mount the view through <AppLayout> / <AdminPageLayout>, or"
    print_info  "  add it to the ALLOWLIST if it is a conscious public/redirect route."
  fi
done < <(find "$PAGES_DIR" -type f -name "*.tsx" -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/")

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "auth-page-guard FAILED — ${VIOLATIONS} page(s) under /app/** with no reachable guard"
  print_info  "Checked: ${CHECKED} · Allowlisted: ${SKIPPED}"
  echo ""
  exit 1
fi

print_success "auth-page-guard PASSED — all ${CHECKED} in-scope /app/** pages reach a guard (${SKIPPED} allowlisted)"
exit 0
