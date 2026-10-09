#!/usr/bin/env bash
# cp-recursive-nesting.sh — Guard: recursive `cp` must copy CONTENTS (`src/.`),
# never the directory itself.
#
# INTENT:
#   `cp -r <src> <dst>` behaves differently depending on whether <dst> already
#   exists: missing → <dst> becomes a copy of <src>; EXISTING → <src> lands INSIDE
#   it as <dst>/<basename src>. Deploy targets almost always already exist, so the
#   same line that worked in testing silently nests in production:
#     • 2026-08-02: `cp -r public public` → public/public → 24h of 404 on every
#       static asset (HTML kept returning 200, so nothing looked broken),
#     • 2026-08-20 (S85): the same shape on `.next/static` would have 404'd the
#       ENTIRE JS/CSS bundle; found before it shipped.
#   The glob variant `cp -r "$src/"*` is the same class: it silently drops
#   dotfiles (`.gitignore`, `.well-known`) because `*` does not match them.
#   Both were fixed by hand; without a ratchet the shape grows back — this guard
#   is the reason it cannot.
#
# WHAT IT CHECKS:
#   Every recursive `cp` (-r / -R / -a, in any flag combination) under scripts/**
#   must take a source ending in `/.` — the form that copies contents and is
#   immune to whether the destination exists. Comments are stripped before
#   matching, so prose that merely MENTIONS the bad shape (the DECISION notes in
#   deploy-frontend and cp-kernel warning "NEVER cp -r src dst") stays green.
#
# ESCAPE: append `cp-nest-allow: <reason>` on the same line or the line above
#   (inline, no central allowlist) — e.g. copying a single file with -r.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCAN_DIR="${SCRIPTS_DIR_OVERRIDE:-${ROOT}/scripts}"

print_boxed_header "Recursive cp: contents-form enforcement" "📁"

if [[ ! -d "$SCAN_DIR" ]]; then
    print_error "Scan dir not found: $SCAN_DIR"
    exit 1
fi

violations=$(find "$SCAN_DIR" -type f -not -path '*/node_modules/*' -print0 \
  | xargs -0 awk '
    # Escape may live on the line itself or the line directly above it.
    { raw = $0 }
    raw ~ /cp-nest-allow:/ { allow_next = 1; prev_allow = 1; next_ok = 1 }

    {
      line = raw
      # Strip comments BEFORE matching: a warning that merely names the bad shape
      # ("NEVER cp -r src dst") must not read as a violation. Requires whitespace
      # before # so bash parameter expansion (${VAR#pat}) survives untouched.
      sub(/^[ \t]*#.*/, "", line)
      sub(/[ \t]#.*/, "", line)

      if (line ~ /(^|[;&|(]|[ \t])cp[ \t]/) {
        # Split into tokens after the cp word; find flags + first operand.
        rest = line
        sub(/^.*(^|[;&|(]|[ \t])cp[ \t]+/, "", rest)
        n = split(rest, tok, /[ \t]+/)
        recursive = 0; src = ""
        for (i = 1; i <= n; i++) {
          t = tok[i]
          if (t ~ /^-/) {
            if (t ~ /[rRa]/) recursive = 1
            continue
          }
          if (src == "") { src = t; break }
        }
        if (recursive && src != "") {
          clean = src
          gsub(/["'"'"']/, "", clean)      # drop quotes: "${X}/." → ${X}/.
          if (clean !~ /\/\.$/ && prev_allow != 1) {
            printf "%s:%d: %s\n", FILENAME, FNR, gensub(/^[ \t]+/, "", 1, raw)
          }
        }
      }
      prev_allow = allow_next; allow_next = 0
    }
  ' || true)

if [[ -n "$violations" ]]; then
    print_error "Recursive cp copying the DIRECTORY instead of its contents:"
    echo "$violations" | sed "s|${ROOT}/||" | sed 's/^/    /'
    echo
    print_info "Fix: mkdir -p \"\$dst\" && cp -Rp \"\$src/.\" \"\$dst/\""
    print_info "Why: with an EXISTING \$dst, 'cp -r \$src \$dst' nests into \$dst/\$(basename \$src);"
    print_info "     the glob form 'cp -r \$src/*' silently drops dotfiles."
    print_info "Intentional exception: append 'cp-nest-allow: <reason>' on that line."
    exit 1
fi

print_success "Recursive cp: all copies use the contents-form (src/.)"
exit 0
