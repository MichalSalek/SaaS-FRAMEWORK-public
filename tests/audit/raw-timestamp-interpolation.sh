#!/usr/bin/env bash
# raw-timestamp-interpolation.sh — Guard against raw wire timestamps (`*_at` ISO
# strings) rendered straight into an i18n `t(..., { date: ... })` interpolation.
#
# INTENT:
#   Wire DTO fields ending in `_at` (paired_at, created_at, ...) are ISO 8601
#   strings ("2026-06-15T10:30:00.000Z"). i18n messages use PLAIN interpolation
#   ("Sparowano {date}"), NO ICU date skeleton, so passing a raw `_at` field
#   renders the literal ISO string to the user. The project convention (see
#   application/date/date.utils.ts + ClientProfilePaired) is to format FIRST —
#   formatDate(paired_at, locale) — then interpolate. turbo-review S61 fixed three
#   pairing surfaces (StylistPairedClients + PairedList ×2) that leaked raw ISO;
#   this ratchet keeps that from sliding back when a new paired/created surface is
#   added.
#
# SCOPE: main/src/**/*.{ts,tsx}, excluding tests.
#
# DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
#   Poprzednia wersja skanowała JEDNĄ LINIĄ:
#     grep -rnE "t\([^)]*\bdate:[[:space:]]*…_at"
#   Ten wzorzec wymagał `t(` i `date:` w tej samej linii, bez `)` pomiędzy — a repo
#   formatuje takie wywołania WIELOLINIJKOWO (prettier łamie obiekt argumentu):
#       const pairedAtLabel = t('pairedAt', {
#         date: formatDate(stylist.paired_at, locale),
#       });
#   Skutek zmierzony: WSZYSTKIE TRZY miejsca, dla których ten strażnik powstał
#   (PairedList.parts.molecule, ClientProfilePaired.parts.organism,
#   StylistPairedClients.parts.molecule) są wielolinijkowe, a jedyny kształt, jaki
#   stary regex łapał, występował w repo ZERO razy. Strażnik nie umiał więc wykryć
#   własnej klasy regresji: cofnięcie dowolnej z tych trzech poprawek zostawiłoby go
#   zielonym. Dlatego skan jest teraz nawiasowo-zbalansowany (perl, slurp), a nie
#   liniowy — i dlatego ma fixture w `_fixtures/raw-timestamp-interpolation/`,
#   który pinuje OBA kształty (jedno- i wielolinijkowy).
#
#   Podłoga obecności liczy MIEJSCA WYWOŁANIA (`t(` z argumentem `date:`), a nie
#   pliki. Liczenie plików dawało 1107 nawet wtedy, gdy wzorzec nie pasował do
#   niczego — czyli dokładnie tę fałszywą zieleń, którą ten strażnik miał wykluczać.
#
# COMPLIANT: the `date:` value runs through a formatter (a call expression), or the
#   line carries an inline `raw-timestamp-allow: <reason>` escape.
#
# EXIT: 0 if PASS, 1 if a raw `_at` field is interpolated without a formatter.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"

print_boxed_header "Raw timestamp interpolation: format *_at before t({date})" "🕒"

if [[ ! -d "$SRC_DIR" ]]; then
  print_success "No main/src — nothing to scan"
  exit 0
fi

print_header "Scanning ${SRC_DIR} for t({ date: <field>_at }) without a formatter"

SCAN_OUTPUT=$(
  find "$SRC_DIR" \( -name '*.ts' -o -name '*.tsx' \) \
    -not -name '*.test.*' -not -name '*.spec.*' -print0 2>/dev/null |
    xargs -0 --no-run-if-empty perl -0777 -ne '
      my $src = $_;
      my $file = $ARGV;

      # Every `t(` call, with its balanced argument list extracted, so a `date:`
      # broken onto its own line is still seen as part of THIS call.
      while ($src =~ /\bt\s*\(/g) {
        my $open = pos($src) - 1;
        my $depth = 0;
        my $close = $open;
        for (my $i = $open; $i < length($src); $i++) {
          my $ch = substr($src, $i, 1);
          $depth++ if $ch eq "(";
          if ($ch eq ")") { $depth--; if ($depth == 0) { $close = $i; last; } }
        }
        next if $close <= $open;
        my $args = substr($src, $open, $close - $open + 1);

        # `date:` argument value — up to the next comma or closing brace.
        next unless $args =~ /\bdate:\s*([^,}\n]+)/;
        my $expr = $1;
        $expr =~ s/\s+$//;

        my $abs = $open + $-[1];
        my $line = 1 + (substr($src, 0, $abs) =~ tr/\n//);

        # A call expression means a formatter ran (formatDate, formatDateShort,
        # Intl.DateTimeFormat().format, a locale helper...). Only a BARE property
        # access to a wire `*_at` field is the violation.
        next if $expr =~ /\(/;
        next unless $expr =~ /^[A-Za-z_][A-Za-z0-9_.?\[\]!]*_at\b/;

        # Inline escape lives on the same source line as the `date:` argument.
        my $line_start = rindex($src, "\n", $abs) + 1;
        my $line_end = index($src, "\n", $abs);
        $line_end = length($src) if $line_end < 0;
        my $line_text = substr($src, $line_start, $line_end - $line_start);
        next if $line_text =~ /raw-timestamp-allow:/;

        print "VIOLATION\t$file:$line\t$expr\n";
      }

      # Presence floor: count call SITES that pass a `date:` at all.
      my $sites = 0;
      $sites++ while $src =~ /\bdate:\s*[^,}\n]+/g;
      print "SITE\t$sites\n" if $sites > 0;
    ' 2>/dev/null || true
)

VIOLATIONS=$(echo "$SCAN_OUTPUT" | grep -E '^VIOLATION' || true)
SITES=$(echo "$SCAN_OUTPUT" | awk -F'\t' '$1=="SITE" {n+=$2} END {print n+0}')

print_info "Scanned ${SITES} t({ date: ... }) interpolation site(s)"
require_scanned "$SITES" "no t({ date: ... }) interpolation site found — the scanner matched nothing, which is the false-green this guard exists to prevent"

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | grep -c '' || true)
  print_error "Raw timestamp interpolation FAILED — ${COUNT} raw *_at field(s) in t({date}):"
  echo ""
  echo "$VIOLATIONS" | awk -F'\t' '{ printf "  %s  →  date: %s\n", $2, $3 }'
  echo ""
  echo "Fix: format the wire ISO before interpolation, e.g."
  echo "  t('pairedAt', { date: formatDate(record.paired_at, locale) })"
  echo "  (formatDate / formatDateShort / formatMonthYear — application/date/date.utils.ts;"
  echo "   get locale via next-intl useLocale())."
  echo "Deliberate exception: append '// raw-timestamp-allow: <reason>' on the line."
  exit 1
fi

print_success "Raw timestamp interpolation passed — every t({date}) formats its *_at source"
exit 0
