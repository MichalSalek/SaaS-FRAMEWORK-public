#!/bin/bash

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
    # AUDIT_ROOT_OVERRIDE — wyłącznie dla self-testu strażników
    # (tests/audit/audit-selftest.sh). Bez tego audytu NIE DA SIĘ sprawdzić:
    # skanuje sztywno drzewo repo, więc nie ma jak podstawić mu próbki, która
    # MUSI go wywrócić. A strażnik, który nigdy nie udowodnił, że łapie własne
    # naruszenie, potrafi latami raportować zieleń nad żywym długiem — zdarzyło
    # się w tym repo dwa razy (ratchet gwiazdek na złych współrzędnych, ratchet
    # tintów wymagający złota na pierwszej pozycji color-mix).
    if [[ -n "${AUDIT_ROOT_OVERRIDE:-}" ]]; then
        echo "$AUDIT_ROOT_OVERRIDE"
        return 0
    fi
    # Root z POŁOŻENIA TEGO PLIKU, nie z gita. `git rev-parse --show-toplevel`
    # oddaje repo, w którego kontekście akurat jesteśmy — a przy odziedziczonym
    # GIT_DIR (push/commit z submodułu) jest to `.git/modules/<sub>`, więc root
    # rozwiązywał się NA SUBMODUŁ i z 101 audytów 54 raportowały zieleń nad
    # nieistniejącym drzewem („No main/src — nothing to scan"). `_utils.sh`
    # zawsze leży w `<root>/tests/audit/`, więc jego własna ścieżka jest
    # jedynym źródłem, którego żadna zmienna środowiskowa nie przestawi.
    local root
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)" || {
        echo "ERROR: nie umiem rozwiązać roota z położenia _utils.sh" >&2
        exit 1
    }

    # ── FLOOR OBECNOŚCI (S102) ────────────────────────────────────────────
    # `git rev-parse --show-toplevel` oddaje repo, w którego kontekście jesteśmy
    # — a to bywa NIE TYM repo, które audyty mają skanować. Dwa zmierzone
    # przypadki: (1) push z submodułu zostawia odziedziczone GIT_DIR wskazujące
    # `.git/modules/<sub>`, więc root rozwiązywał się NA SUBMODUŁ i z 101
    # audytów 54 raportowały zieleń nad nieistniejącym drzewem („No main/src —
    # nothing to scan"); (2) w pomiarze S102 62 ze 106 audytów zwracało sukces
    # uruchomione na PUSTYM katalogu, bo żaden nie sprawdza, czy w ogóle miał
    # co skanować. Zieleń nad pustką jest gorsza niż czerwień: wygasza czujność
    # dokładnie wtedy, gdy bramka przestała cokolwiek mierzyć.
    #
    # Naprawa siedzi TU, a nie w 62 skryptach, bo 105 ze 108 przechodzi przez tę
    # funkcję — jedno miejsce zamyka klasę dla prawie całego katalogu. Sama
    # ścieżka z BASH_SOURCE nie wystarcza: gdyby ktoś skopiował `tests/audit`
    # gdzie indziej, root wskazywałby katalog bez drzewa do skanowania.
    # Dlatego jeszcze potwierdzamy KSZTAŁT — a gdy się nie zgadza, fail jest
    # GŁOŚNY, nie ciche „0 plików ✓".
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

# Czy katalog ma kształt roota tego monorepo. Świadomie sprawdzamy KATALOGI,
# a nie pliki: pojedynczy plik bywa przenoszony, zestaw czterech katalogów
# opisuje strukturę, która definiuje to repo.
_looks_like_project_root() {
    local d="${1:-}"
    [ -n "$d" ] || return 1
    [ -d "$d/tests/audit" ] && [ -d "$d/.shared-kernel" ] \
        && [ -d "$d/main/src" ] && [ -d "$d/web-1/src" ]
}

# ── require_scanned — floor obecności NA POZIOMIE POJEDYNCZEGO AUDYTU ─────
# `get_project_root` broni przed skanowaniem złego drzewa; ta funkcja broni
# przed drugą połową tej samej klasy: root jest poprawny, ale konkretny audyt
# szuka podkatalogu albo wzorca, który zniknął po refaktorze, więc jego własny
# zbiór wejściowy jest pusty i pętla walidująca po prostu się nie wykonuje.
# Wołaj ją zaraz po zbudowaniu listy plików/rekordów do sprawdzenia.
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
# Helper: wypisz plik z WYCIĘTĄ treścią komentarzy, zachowując numerację linii.
#
# DECISION (nie usuwaj tego komentarza): powstał po TRZECIM trafieniu tej samej
# klasy — strażnik grepujący wzorzec kodu zapala się na prozie, która ten wzorzec
# tylko OPISUJE. Kolejno: `": any"` w komentarzu blokowało push przy zielonym tsc,
# `[aria-modal="true"]` w DECISION zapalało aria-modal-focus-trap, a `<img>` w
# zdaniu o długim przytrzymaniu — bundle-budget. Za każdym razem „naprawą" było
# przeformułowanie zdania, czyli oddanie pola strażnikowi, który mierzy nie to,
# co deklaruje.
#
# Filtr `^(//|\*)` z brand-literals tu NIE wystarcza: dominującym stylem w tym
# repo jest blok JSX `{/* … */}`, w którym kolejne linie zaczynają się zwykłym
# tekstem, nie gwiazdką. Dlatego pełny strip obu form komentarza.
#
# Treść komentarzy zastępujemy SPACJAMI, nie usuwamy — numery linii i kolumn
# zostają nietknięte, więc komunikaty strażników nadal wskazują właściwe miejsce.
# Znaki komentarza w literale stringowym są tu świadomie traktowane jak komentarz:
# strażniki tego repo szukają wzorców kodu, a nie zawartości stringów, więc
# fałszywy negatyw na `"http://…"` jest tańszy niż utrzymywanie parsera stringów
# w bashu.
strip_comments_keep_lines() {
    perl -0777 -pe '
        s{(/\*.*?\*/)}{ my $c = $1; $c =~ s/[^\n]/ /g; $c }gse;
        s{//[^\n]*}{}g;
    ' "$1"
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
