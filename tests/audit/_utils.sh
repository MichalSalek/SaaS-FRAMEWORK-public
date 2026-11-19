#!/bin/bash

# DECISION: every audit runs under a UTF-8 character locale it picks itself, whatever the caller
# exported. The guards match UTF-8 text (dashes, middle dots, Polish letters) with `grep -P` code
# points and bracket expressions; under LC_ALL=C those silently stop matching (must-fail fixtures of
# copy-dashes and blog-copy-rules passed under LC_ALL=C). A clean ubuntu
# has C.UTF-8 built into glibc, so nothing is installed and the machine locale is not changed;
# this only fixes the locale of the audit processes. C.UTF-8 collates by code point, which for
# UTF-8 is byte order, so `sort`/`comm` behave as under C. If no UTF-8 locale exists at all, the
# caller's locale is kept.
_audit_pick_utf8_locale() {
    local candidate
    for candidate in C.UTF-8 C.utf8 en_US.UTF-8 en_US.utf8; do
        if locale -a 2>/dev/null | grep -qx "$candidate"; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}
if _AUDIT_UTF8_LOCALE="$(_audit_pick_utf8_locale)"; then
    export LC_ALL="$_AUDIT_UTF8_LOCALE"
    export LC_CTYPE="$_AUDIT_UTF8_LOCALE"
fi
unset -f _audit_pick_utf8_locale

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'
GRAY='\033[0;90m'

print_header() {
    echo -e "\n${BOLD}${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

print_separator() {
    echo "----------------------------------------"
}

get_project_root() {
    # AUDIT_ROOT_OVERRIDE exists only for the guard self-test (tests/audit/audit-selftest.sh):
    # an audit scans the real repo tree, so without it no sample that MUST fail could be fed to
    # it, and a guard that never proved it catches its own violation can report green over live
    # debt for years.
    if [[ -n "${AUDIT_ROOT_OVERRIDE:-}" ]]; then
        echo "$AUDIT_ROOT_OVERRIDE"
        return 0
    fi
    # Root from the location of THIS file, not from git: `git rev-parse --show-toplevel` follows
    # the current repo context, and with an inherited GIT_DIR (push or commit from a submodule)
    # it resolves to the submodule, so most audits went green over a tree that did not exist.
    # `_utils.sh` always lives in `<root>/tests/audit/`, which no environment variable can move.
    local root
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)" || {
        echo "ERROR: nie umiem rozwiązać roota z położenia _utils.sh" >&2
        exit 1
    }

    # PRESENCE FLOOR: the path alone is not enough (a copied `tests/audit` would point at a
    # directory with nothing to scan), so the SHAPE of the root is confirmed too. Green over an
    # empty tree is worse than red: it silences attention exactly when the gate measures nothing.
    # The fix lives here because nearly every audit goes through this function. A mismatch fails
    # LOUDLY, never as a quiet "0 files".
    if ! _looks_like_project_root "$root"; then
        echo "" >&2
        echo "ERROR: rozwiązany katalog nie wygląda jak root tego repo." >&2
        echo "  Sprawdzany: $root" >&2
        echo "  Oczekiwane: tests/audit/ + .shared-kernel/ + main/src/ + web-1/src/" >&2
        echo "  Audyt bez drzewa do skanowania NIE melduje sukcesu — to byłaby" >&2
        echo "  zieleń nad pustką, czyli dokładnie ta klasa, dla której ten" >&2
        echo "  floor powstał." >&2
        echo "" >&2
        exit 1
    fi

    echo "$root"
}

# Does the directory have the shape of this monorepo's root. It checks DIRECTORIES, not files:
# a single file gets moved, a set of four directories describes the structure that defines the repo.
_looks_like_project_root() {
    local d="${1:-}"
    [ -n "$d" ] || return 1
    [ -d "$d/tests/audit" ] && [ -d "$d/.shared-kernel" ] \
        && [ -d "$d/main/src" ] && [ -d "$d/web-1/src" ]
}

# ── require_scanned: presence floor for a SINGLE audit ──
# `get_project_root` guards against scanning the wrong tree; this guards the other half of the
# class: the root is right but one audit looks for a subdirectory or pattern that vanished in a
# refactor, so its input set is empty and the validation loop simply never runs. Call it right
# after building the list of files or records to check.
require_source_dir() {
    local dir="${1:-}" what="${2:-źródła}" ext="${3:-ts}"
    if [ ! -d "$dir" ]; then
        print_error "Katalog ${what} nie istnieje: ${dir}"
        echo "  Audyt nie ma czego skanować, więc NIE melduje sukcesu." >&2
        exit 1
    fi
    if [ -z "$(find "$dir" -type f -name "*.${ext}" -print -quit 2>/dev/null)" ]; then
        print_error "Katalog ${what} nie zawiera ŻADNEGO pliku .${ext}: ${dir}"
        echo "  Zielony wynik nad pustym katalogiem byłby fałszywy — to znaczy," >&2
        echo "  że ścieżka w tym audycie rozjechała się ze strukturą repo." >&2
        exit 1
    fi
}

require_scanned() {
    local count="${1:-0}" what="${2:-wejść}"
    case "$count" in
        ''|*[!0-9]*) count=0 ;;
    esac
    if [ "$count" -eq 0 ]; then
        print_error "Nie znaleziono ŻADNYCH ${what} do sprawdzenia — audyt nie ma czego pilnować."
        echo "  Zielony wynik nad pustym zbiorem byłby fałszywy: to znaczy, że" >&2
        echo "  ścieżka/wzorzec w tym audycie rozjechał się ze strukturą repo." >&2
        exit 1
    fi
}

# Shared temp file management
AUDIT_TEMP_FILES=()

create_temp_file() {
    local prefix="${1:-audit}"
    local tmp="/tmp/${prefix}_$$"
    AUDIT_TEMP_FILES+=("$tmp")
    echo "$tmp"
}

cleanup_temp_files() {
    for f in "${AUDIT_TEMP_FILES[@]}"; do
        rm -f "$f"
    done
}

count_items() {
    echo "$1" | grep -v '^$' | wc -l
}

print_boxed_header() {
    local title="$1"
    local emoji="${2:-}"
    local width=50
    local display_title="${emoji:+$emoji }$title"
    echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║  $display_title${NC}"
    echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}\n"
}

print_table_header() {
    local col1="$1" col2="$2" col3="$3"
    echo -e "\n${BOLD}┌─────────────────┬────────┬─────────────────┐${NC}"
    printf "${BOLD}│${NC} %-15s ${BOLD}│${NC} %-6s ${BOLD}│${NC} %-15s ${BOLD}│${NC}\n" "$col1" "$col2" "$col3"
    echo -e "${BOLD}├─────────────────┼────────┼─────────────────┤${NC}"
}

print_table_row() {
    local col1="$1" col2="$2" col3="$3" color="$4"
    printf "${color}│${NC} %-15s ${color}│${NC} %-6s ${color}│${NC} %-15s ${color}│${NC}\n" "$col1" "$col2" "$col3"
}

print_table_footer() {
    echo -e "${BOLD}└─────────────────┴────────┴─────────────────┘${NC}"
}

# ─── Shared event extraction from app-events.const.ts ───
# Robust awk-based parser using indentation (not fragile sed ranges).
# Output: TSV lines — SECTION\tDOMAIN\tEVENT_NAME
# Example: COMMANDS\tADMIN\tSEND_LOG
#
# NOTE: CONFIRMATIONS section is FLAT (no DOMAIN nesting) — events live directly
# at 4-space indent under CONFIRMATIONS. Synthetic domain "LINK" assigned so the
# TSV shape stays uniform (SECTION\tDOMAIN\tEVENT).
#
# Usage: extract_events_with_domain "$APP_EVENTS_FILE" > output.tsv
# Filter: extract_events_with_domain "$FILE" | awk -F'\t' '$1=="COMMANDS"'
extract_events_with_domain() {
    local file="$1"
    [[ ! -f "$file" ]] && { echo "ERROR: $file not found" >&2; return 1; }

    awk '
    # Top-level sections at 2-space indent
    /^  COMMANDS:[[:space:]]*\{/      { section="COMMANDS";      flat_section=0; next }
    /^  QUERIES:[[:space:]]*\{/       { section="QUERIES";       flat_section=0; next }
    /^  INFO:[[:space:]]*\{/          { section="INFO";          flat_section=0; next }
    # CONFIRMATIONS is flat (no DOMAIN nesting) — synthesize domain "LINK"
    /^  CONFIRMATIONS:[[:space:]]*\{/ { section="CONFIRMATIONS"; flat_section=1; domain="LINK"; next }

    # Domain level at 4-space indent (skip empty blocks like EVENT_LOG: {})
    # Only applies to nested sections (COMMANDS/QUERIES/INFO).
    /^    [A-Z][A-Z_0-9]+:[[:space:]]*\{/ && section && !flat_section {
        domain = $0
        gsub(/^[[:space:]]+/, "", domain)
        gsub(/:[[:space:]]*\{.*/, "", domain)
        next
    }

    # Event values:
    #   - 6-space indent for nested sections (COMMANDS/QUERIES/INFO)
    #   - 4-space indent for flat sections (CONFIRMATIONS)
    /^      [A-Z_][A-Z0-9_]+:[[:space:]]*'\''[A-Z_]/ && section && domain && !flat_section {
        line = $0
        match(line, /'\''[A-Z_][A-Z0-9_]*'\''/)
        if (RSTART > 0) {
            event = substr(line, RSTART+1, RLENGTH-2)
            printf "%s\t%s\t%s\n", section, domain, event
        }
    }
    /^    [A-Z_][A-Z0-9_]+:[[:space:]]*'\''[A-Z_]/ && section && domain && flat_section {
        line = $0
        match(line, /'\''[A-Z_][A-Z0-9_]*'\''/)
        if (RSTART > 0) {
            event = substr(line, RSTART+1, RLENGTH-2)
            printf "%s\t%s\t%s\n", section, domain, event
        }
    }

    # Close domain on 4-space closing brace (only for nested sections)
    /^    \}/ && section && !flat_section { domain = "" }

    # Close section on 2-space closing brace
    /^  \}/ && section { section = ""; domain = ""; flat_section=0 }
    ' "$file"
}

# Helper: extract only COMMANDS+QUERIES+CONFIRMATIONS events (handler events)
# CONFIRMATIONS = GET-as-Command from email links (see app-events.const.ts CONFIRMATIONS section).
extract_handler_events() {
    extract_events_with_domain "$1" | awk -F'\t' '$1=="COMMANDS" || $1=="QUERIES" || $1=="CONFIRMATIONS"'
}

# Helper: extract only INFO events
extract_info_events() {
    extract_events_with_domain "$1" | awk -F'\t' '$1=="INFO"'
}

# Helper: domain name → DTO directory name (lowercase, underscore→hyphen)
domain_to_dto_dir() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | tr '_' '-'
}

print_dashboard() {
    local passed="$1" failed="$2" total_time="$3"
    echo -e "\n${BOLD}┌─────────────────────────────────────┐${NC}"
    echo -e "${BOLD}│ AUDIT SUMMARY                       │${NC}"
    echo -e "${BOLD}├─────────────────────────────────────┤${NC}"
    printf "${BOLD}│${NC} ${GREEN}✅ Passed: %-2s${NC}                      ${BOLD}│${NC}\n" "$passed"
    printf "${BOLD}│${NC} ${RED}❌ Failed: %-2s${NC}                      ${BOLD}│${NC}\n" "$failed"
    printf "${BOLD}│${NC} Total time: %-20s ${BOLD}│${NC}\n" "$total_time"
    echo -e "${BOLD}└─────────────────────────────────────┘${NC}"
}
# ─────────────────────────────────────────────────────────────────────────────
# Helper: print a file with comment content CUT OUT, keeping line numbering.
#
# DECISION: a guard that greps for a code pattern lights up on prose that only DESCRIBES the
# pattern (`": any"` in a comment, `[aria-modal="true"]` in a note). Rewording the prose hands
# the field to a guard that measures something other than what it claims, so strip comments
# instead. The `^(//|\*)` line filter is not enough here: JSX `{/* ... */}` blocks continue on
# plain text lines, so both comment forms are removed. Content becomes spaces, not nothing, so
# line and column numbers stay put. Comment markers inside string literals are treated as
# comments on purpose: a false negative on "http://..." is cheaper than a string parser in bash.
strip_comments_keep_lines() {
    perl -0777 -pe '
        s{(/\*.*?\*/)}{ my $c = $1; $c =~ s/[^\n]/ /g; $c }gse;
        s{//[^\n]*}{}g;
    ' "$1"
}

# Contract handler: the file BINDS a kernel contract. Comments are stripped and
# newlines joined (prettier may break the call). A binding is
# `defineEndpoint(<DOMAIN>_CONTRACTS.<KEY>` or `bindEndpoint` of the same shape
# (one file, two verbs: salon staff). A mention in a comment is not a binding.
# Prints every bound key, one per line; exit 1 when the file binds none.
#   contract_binding_key <file>
CONTRACT_BINDING_RE='(?:defineEndpoint|bindEndpoint)\(\s*[A-Z][A-Z0-9_]*_CONTRACTS\.\K[A-Z][A-Z0-9_]*'
contract_binding_key() {
    local keys
    keys=$(strip_comments_keep_lines "$1" | tr '\n' ' ' | grep -oP "$CONTRACT_BINDING_RE")
    [[ -n "$keys" ]] || return 1
    printf '%s\n' "$keys"
}

# Batch sibling of strip_comments_keep_lines: ONE perl process over many files,
# printing `path:line:content` (grep -n shape) for every line that matches a perl
# regex AFTER the comment strip. A 2k-file scan through the per-file variant would
# spawn 2k perls; this keeps typescript-strictness under a second. Same strip
# rules — and the same accepted `http://` false negative — as above.
#   grep_code_stripped '<perl-regex>' file1 file2 …
grep_code_stripped() {
    local re="$1"; shift
    [[ $# -gt 0 ]] || return 0
    perl -e '
        my $re = shift @ARGV;
        local $/;
        for my $f (@ARGV) {
            open(my $h, "<", $f) or next; my $s = <$h>; close $h;
            $s =~ s{(/\*.*?\*/)}{ my $c = $1; $c =~ s/[^\n]/ /g; $c }gse;
            $s =~ s{//[^\n]*}{}g;
            my $n = 0;
            for my $line (split /\n/, $s, -1) { $n++; print "$f:$n:$line\n" if $line =~ /$re/; }
        }
    ' "$re" "$@"
}
