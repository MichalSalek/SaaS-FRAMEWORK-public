#!/usr/bin/env bash
# copy-dashes.sh — Guard against banned punctuation in everything a person
# reads: em-dash / en-dash (— –) and, since 2026-10-08, the middle dot (·)
# (anti-AI-slop floor §7 of the 7×ZERO).
#
# INTENT:
#   The em-dash (U+2014) and en-dash (U+2013) as sentence punctuation are a
#   model-default "AI slop" tell (DESIGN.md §Anti-AI-Slop). User-facing copy uses a comma, colon, period,
#   parenthesis or semicolon instead. Word-internal hyphens (e-mail, B+R) and
#   explicit ranges written "od 9 do 17" are unaffected — they don't use the
#   dash code points at all. The S30 /ui sweep removed the last 20 occurrences
#   from FAQ copy, an alt text, SEO titles and a dialog; this audit keeps that
#   ratchet from sliding back when copy is next edited.
#
#   MIDDLE DOT (U+00B7), owner 2026-10-08: „nie stosuj tych środkowych kropek
#   jako interpunkcji, dodaj to do anti slop zasad generalnych”. The dot had
#   become the house separator exactly because the dash was banned: „Plan Free
#   bez karty · 30 dni Pro”, „Admin · Przegląd”, „${title} · ${brand}”, and CSS
#   `content: '·'` between list items. S126 removed all of it (34 locale values
#   ×3 languages, ~70 code sites, 3 CSS separators); this guard keeps it out.
#   A list of facts takes commas or sentences, a label plus qualifier a colon,
#   a page name plus brand „|”, adjacent items a gap or a CSS-generated comma.
#
# SECTION 1 — LOCALE COPY (dashes AND middle dot). Scan roots: every i18n value
#   file under main/src/locales/**/*.json (the SSOT for user-facing copy:
#   common.json + events.json × pl/en/de) AND the kernel e-mail locales
#   .shared-kernel/domain/email/locales/*.json (every lifecycle and
#   transactional mail; until 2026-09-23 the guard never looked there). Locale
#   JSON is pure copy, so any of the three characters there is punctuation,
#   never structural, hence FP-free and WITHOUT an escape. The characters are
#   matched as literals, as JSON escapes (—, ·) and as HTML entities
#   (&mdash; &middot; &#183;), because a mail body is HTML and an escape
#   renders exactly like the literal.
#
# SECTION 2 — RENDERED MIDDLE DOT IN CODE. Scan root: main/src (one root, not
#   a directory list), every *.ts / *.tsx except tests and the kernel mirror
#   READONLY-shared-kernel, plus every *.css. Comments are blanked first
#   (string-aware, so `https://…` inside a literal is not mistaken for a line
#   comment); whatever is left is code, and code can hold a middle dot only
#   where it renders: a string or template literal, JSX text, an attribute, a
#   CSS `content` value or a custom property feeding one. So the rule is "any
#   middle dot outside a comment", in every spelling: literal, `·`,
#   `\xb7`, `&middot;`, `&#183;`, and the CSS escape `\b7`. Prose may keep the
#   character: DECISION comments quoting old copy stay untouched.
#
#   ESCAPE (code only): `middle-dot-allow: <reason>` ON THE SAME LINE, reason
#   mandatory. A bare marker is itself a violation.
#
# PRESENCE: both locale roots and main/src must exist and must contain what
#   is scanned (JSON string values per root; ts/tsx and css files). A renamed
#   directory fails the guard instead of passing it silently.
#
# FIXTURES: tests/audit/_fixtures/copy-dashes/ (run by audit-selftest).
#
# EXIT: 0 if PASS, 1 on any dash or middle dot.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCAN_ROOTS=(
  "${ROOT}/main/src/locales"
  "${ROOT}/.shared-kernel/domain/email/locales"
)
CODE_ROOT="${ROOT}/main/src"

print_boxed_header "Copy punctuation: no em/en-dash, no middle dot in what a person reads" "✍️"

# ─── Presence floor ─────────────────────────────────────────────────────────
for dir in "${SCAN_ROOTS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    print_error "Copy dashes: scan root missing: ${dir#"$ROOT"/}"
    exit 1
  fi
  json_files=$(find "$dir" -type f -name '*.json' | wc -l | tr -d ' ')
  if [[ "$json_files" -eq 0 ]]; then
    print_error "Copy dashes: no *.json under ${dir#"$ROOT"/} (presence floor)"
    exit 1
  fi
  # A file count says nothing about copy: count the string VALUES scanned.
  json_values=$(find "$dir" -type f -name '*.json' -print0 \
    | xargs -0 grep -hcE '":[[:space:]]*"' | awk '{ s += $1 } END { print s + 0 }')
  require_scanned "$json_values" "wartości tekstowych w ${dir#"$ROOT"/}"
  print_info "${dir#"$ROOT"/}: ${json_files} plików JSON, ${json_values} wartości tekstowych"
done

if [[ ! -d "$CODE_ROOT" ]]; then
  print_error "Copy dashes: scan root missing: main/src"
  exit 1
fi

mapfile -t CODE_FILES < <(find "$CODE_ROOT" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/READONLY-shared-kernel/*' \
  -not -path '*/__tests__/*' -not -path '*/__mocks__/*' \
  -not -name '*.test.ts' -not -name '*.test.tsx' \
  -not -name '*.spec.ts' -not -name '*.spec.tsx' | sort)
mapfile -t CSS_FILES < <(find "$CODE_ROOT" -type f -name '*.css' \
  -not -path '*/READONLY-shared-kernel/*' | sort)

require_scanned "${#CODE_FILES[@]}" "plików ts/tsx pod main/src"
require_scanned "${#CSS_FILES[@]}" "plików css pod main/src"
print_info "main/src: ${#CODE_FILES[@]} plików ts/tsx, ${#CSS_FILES[@]} plików css"

FAILED=0

# ─── Section 1: locale copy ─────────────────────────────────────────────────
print_header "Sekcja 1: locale JSON (aplikacja + e-maile kernela)"

DASH_HITS=$(grep -rnP '[\x{2014}\x{2013}]|(?i)\\u201[34]|&(mdash|ndash|#821[12]|#x201[34]);' \
  "${SCAN_ROOTS[@]}" --include='*.json' 2>/dev/null || true)
DOT_HITS=$(grep -rnP '\x{00B7}|(?i)\\u00b7|&(middot|#0*183|#x0*b7);' \
  "${SCAN_ROOTS[@]}" --include='*.json' 2>/dev/null || true)

if [[ -n "$DASH_HITS" ]]; then
  FAILED=1
  print_error "Copy dashes FAILED — $(grep -c '' <<<"$DASH_HITS") em/en-dash(es) in user-facing copy (floor §7):"
  echo ""
  sed "s|^${ROOT}/||" <<<"$DASH_HITS"
  echo ""
  echo "Fix: replace the dash with a comma, colon, period, parenthesis or"
  echo "semicolon (DESIGN.md §Anti-AI-Slop / UI-FRONTEND-RULES §2.7)."
  echo "Ranges: write \"od 9 do 17\", not \"9–17\"."
  echo ""
fi

if [[ -n "$DOT_HITS" ]]; then
  FAILED=1
  print_error "Copy dashes FAILED — $(grep -c '' <<<"$DOT_HITS") middle dot(s) in user-facing copy (floor §7):"
  echo ""
  sed "s|^${ROOT}/||" <<<"$DOT_HITS"
  echo ""
  echo "Fix: a list of facts takes commas or separate sentences, a label plus"
  echo "qualifier a colon, a page name plus brand \"|\". No escape in locale JSON."
  echo ""
fi

# ─── Section 2: rendered middle dot in code ─────────────────────────────────
print_header "Sekcja 2: kropka środkowa renderowana z kodu (ts/tsx + css)"

# One perl process over all files. Prints `path:line:content` for a violation
# and `path:line:[bare-marker] content` for a marker without a reason.
scan_code() {
  local mode="$1"; shift
  [[ $# -gt 0 ]] || return 0
  perl -e '
    use strict; use warnings; use utf8;
    binmode(STDOUT, ":encoding(UTF-8)");
    my ($mode, $root) = (shift @ARGV, shift @ARGV);
    my $dot = $mode eq "css"
      ? qr/\x{00B7}|\\0{0,4}[bB]7(?![0-9a-fA-F])|&middot;/
      : qr/\x{00B7}|\\u00[bB]7|\\u\{0*[bB]7\}|\\x[bB]7|&middot;|&#0*183;|&#[xX]0*[bB]7;/;
    my $blank = sub { my $c = shift; $c =~ s/[^\n]/ /g; $c };
    for my $f (@ARGV) {
      open(my $h, "<:encoding(UTF-8)", $f) or next;
      local $/; my $raw = <$h>; close $h;
      my $s = $raw;
      if ($mode eq "css") {
        $s =~ s{(/\*.*?\*/)}{ $blank->($1) }gse;
      } else {
        # String-aware: a literal is kept whole, so `//` inside "https://…"
        # is not a comment. `(?<!:)` covers a bare URL in JSX text.
        $s =~ s{
            ( "(?:\\.|[^"\\\n])*" | \x27(?:\\.|[^\x27\\\n])*\x27 | `(?:\\.|[^`\\])*` )
          | ( /\*.*?\*/ )
          | ( (?<!:)//[^\n]* )
        }{ defined $1 ? $1 : $blank->(defined $2 ? $2 : $3) }gsex;
      }
      my @code = split /\n/, $s, -1;
      my @orig = split /\n/, $raw, -1;
      (my $rel = $f) =~ s{^\Q$root\E/}{};
      for my $i (0 .. $#code) {
        next unless $code[$i] =~ $dot;
        my $line = $orig[$i] // "";
        (my $shown = $line) =~ s/^\s+//;
        $shown = substr($shown, 0, 160);
        if ($line =~ /middle-dot-allow:/) {
          next if $line =~ /middle-dot-allow:[ \t]*[\p{L}\p{N}][\p{L}\p{N}]+/;
          print "$rel:" . ($i + 1) . ":[bare-marker] $shown\n";
          next;
        }
        print "$rel:" . ($i + 1) . ":$shown\n";
      }
    }
  ' "$mode" "$ROOT" "$@"
}

CODE_HITS="$(scan_code ts "${CODE_FILES[@]}")"
CSS_HITS="$(scan_code css "${CSS_FILES[@]}")"

if [[ -n "$CODE_HITS" ]]; then
  FAILED=1
  print_error "Copy dashes FAILED — $(grep -c '' <<<"$CODE_HITS") rendered middle dot(s) in ts/tsx (string, template literal or JSX text):"
  echo ""
  echo "$CODE_HITS"
  echo ""
fi

if [[ -n "$CSS_HITS" ]]; then
  FAILED=1
  print_error "Copy dashes FAILED — $(grep -c '' <<<"$CSS_HITS") middle dot(s) in CSS (generated content or a string feeding it):"
  echo ""
  echo "$CSS_HITS"
  echo ""
fi

if grep -qF '[bare-marker]' <<<"${CODE_HITS}${CSS_HITS}"; then
  echo "A middle-dot-allow marker without a reason does not exempt the line:"
  echo "write \`middle-dot-allow: <why this dot is not punctuation>\`."
  echo ""
fi

if [[ -n "${CODE_HITS}${CSS_HITS}" ]]; then
  echo "Fix: join facts with a comma or split them into sentences; a document"
  echo "title takes \`\${title} | \${brand}\`; adjacent items take a gap or a comma"
  echo "generated AFTER the item (AppHero.module.css \`.meta > span::after\`)."
  echo "Genuine exception: \`middle-dot-allow: <reason>\` on the same line."
  echo ""
fi

print_separator

if [[ "$FAILED" -ne 0 ]]; then
  exit 1
fi

print_success "Copy dashes passed — no em/en-dash and no middle dot in locale copy, no rendered middle dot in main/src"
exit 0
