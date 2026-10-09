#!/usr/bin/env bash
# scripts/utils.sh
# Shared utilities for deployment and build scripts.

# ==============================================================================
# STRICT MODE
# ==============================================================================
set -o errexit   # Exit on error
set -o nounset   # Exit on unset variable
set -o pipefail  # Exit on pipe error

# ==============================================================================
# COLORS & FORMATTING
# ==============================================================================
if command -v tput >/dev/null 2>&1 && [ -n "${TERM:-}" ] && [ "${TERM}" != "dumb" ]; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    BLUE=$(tput setaf 4)
    MAGENTA=$(tput setaf 5)
    CYAN=$(tput setaf 6)
    BOLD=$(tput bold)
    RESET=$(tput sgr0)
else
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    MAGENTA=""
    CYAN=""
    BOLD=""
    RESET=""
fi

# ==============================================================================
# LOGGING FUNCTIONS
# ==============================================================================
timestamp() {
    date +"%Y-%m-%d %H:%M:%S"
}

info() {
    echo -e "${BLUE}[INFO]${RESET}  $1"
}

success() {
    echo -e "${GREEN}[OK]${RESET}    $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${RESET}  $1" >&2
}

error() {
    echo -e "${RED}[ERROR]${RESET} $1" >&2
}

step() {
    echo -e "\n${BOLD}${CYAN}==>${RESET} ${BOLD}$1${RESET}"
}

header() {
    local title="$1"
    local icon="${2:-🚀}"
    echo ""
    echo -e "${MAGENTA}│${RESET}"
    echo -e "${MAGENTA}│${RESET}   ${icon}  ${BOLD}${title}${RESET}"
    echo -e "${MAGENTA}│${RESET}"
}

# ==============================================================================
# VALIDATION HELPERS
# ==============================================================================
check_required_vars() {
    local missing_vars=()
    for var in "$@"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        echo ""
        error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo -e "  - ${BOLD}${RED}${var}${RESET}"
        done
        echo ""
        exit 1
    fi
}

# ==============================================================================
# UTILS
# ==============================================================================
# Kod 20 = ANULOWANE PRZEZ UZYTKOWNIKA. Wczesniej bylo `exit 0`, czyli odmowa
# ("n") wygladala dla wywolujacego (npm, chain `A && B`, log) IDENTYCZNIE jak
# wykonana robota — deploy, ktorego nie bylo, raportowal sukces. Wszystkie
# call-sites (deploy-backend x2, rollback-frontend) traktuja anulowanie jako
# "nic nie zrobiono", wiec niezerowy kod jest tam poprawna odpowiedzia.
CONFIRM_DECLINED_EXIT_CODE=20

confirm() {
    local message="$1"
    read -rp "$(echo -e "${YELLOW}${message} [y/N]: ${RESET}")" response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        warn "Operation cancelled by user."
        exit $CONFIRM_DECLINED_EXIT_CODE
    fi
}

play_success_sound() {
    if command -v paplay &> /dev/null; then
        paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null &
    fi
}

play_error_sound() {
    if command -v paplay &> /dev/null; then
        paplay /usr/share/sounds/freedesktop/stereo/dialog-error.oga 2>/dev/null &
    else
        echo -e '\a'
    fi
}

# ==============================================================================
# GIT PARITY
# ==============================================================================
# Zwraca "behind ahead" dla repo w $1 wzgledem origin/master (fetch + rev-list).
# Sama MECHANIKA — polityke zostawia wywolujacemu, bo kierunki znacza co innego
# zaleznie od modelu deployu:
#   pull-based (staging odtwarza sie z origin): ahead = Twoj kod tam nie dojedzie,
#   push-based (backend/front buduja lokalnie): behind = wypychasz starszy kod
#                                               i cofasz to, co juz jest na origin.
# Bez fetcha porownanie jest z nieaktualnym origin, wiec brak sieci = glosny WARN,
# nie ciche "0 0" (to bylaby zielen bez pomiaru).
git_parity_counts() {
    local path="$1"
    local counts
    git -C "$path" fetch --quiet origin 2>/dev/null \
        || warn "$(basename "$path"): fetch nieudany — porownuje z OSTATNIO ZNANYM origin/master."
    counts="$(git -C "$path" rev-list --left-right --count origin/master...HEAD 2>/dev/null || printf '0\t0')"
    printf '%s %s' "$(printf '%s' "$counts" | awk '{print $1}')" "$(printf '%s' "$counts" | awk '{print $2}')"
}

# ==============================================================================
# HEALTH PROBE
# ==============================================================================
# Sonda HTTP z retry — czeka na boot aplikacji. "Kontener wstal" / "proces wystartowal"
# NIE znaczy "aplikacja odpowiada", a deploy raportujacy sukces bez tej roznicy to
# najdrozsza klasa bledu w tym repo (doba 404 na statykach, staging w crash-loopie
# meldowany jako OK). BEZ `-k`: blad certyfikatu ma wywrocic gate, nie zniknac.
#
# Uzycie:  assert_http_ok "https://host/sciezka" [proby] [odstep_s]
assert_http_ok() {
    local url="$1"
    local tries="${2:-20}"
    local delay="${3:-3}"
    local i code
    for i in $(seq 1 "$tries"); do
        # `|| echo 000` NIE nadaje sie jako fallback: curl przy odmowie polaczenia SAM
        # wypisuje "000" i konczy sie bledem, wiec doklejenie drugiego dawalo w
        # komunikacie "000000" — kod HTTP, ktory nie istnieje.
        code="$(curl -sS -m 12 -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null)" || code=""
        [ -n "$code" ] || code="000"
        if [ "$code" = "200" ]; then
            success "HTTP OK (${url} = 200)"
            return 0
        fi
        info "health ${i}/${tries}: ${code} (czekam na boot)"
        [ "$i" -lt "$tries" ] && sleep "$delay"
    done
    error "HEALTH FAIL: ${url} nie zwrocil 200 (ostatnio: ${code})"
    return 1
}

is_app_dir() {
    local dir_name="$1"
    [[ "$dir_name" == "main" || "$dir_name" == "web-1" ]]
}
