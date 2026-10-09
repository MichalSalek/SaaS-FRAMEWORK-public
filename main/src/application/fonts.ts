/**
 * Fonty produktu — SSOT definicji i nazw zmiennych CSS.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Loadery `next/font` żyją TUTAJ, a nie w `_app.tsx`, bo klasy ze zmiennymi
 * (`--font-schibsted` itd.) muszą wylądować na `<html>` — czyli w `_document.tsx`.
 * Powód jest mierzalny, nie estetyczny: dopóki zmienne siedziały na wrapper-divie
 * wewnątrz `_app`, każdy węzeł POZA tym divem ich nie widział. Dotyczyło to
 * `<body>` (a więc całego dziedziczenia bazowego) oraz KAŻDEGO portalu
 * montowanego do `document.body` — modali, dialogów i overlayów
 * (`AppModalShell`, `DowngradeWarningDialog`, `GalleryFilterOverlay`).
 * Zmierzone przed naprawą: `getComputedStyle(document.body).fontFamily` = gołe
 * `sans-serif`, a element wstrzyknięty do `body` (symulacja portalu) miał
 * zmienną kroju PUSTĄ. Skutek: cała treść bez własnej deklaracji `font-family`
 * renderowała się systemowym krojem — na stronie konta 109 z 305 elementów
 * z tekstem, w stopce landingu każdy link.
 *
 * `_app.tsx` importuje ten sam moduł, więc font-manifest Next (preload WOFF2)
 * nadal wiąże fonty ze stroną, a nie z samym dokumentem.
 */
import {
  Schibsted_Grotesk,
  Instrument_Sans,
  Marcellus,
  Caveat,
} from 'next/font/google';

/**
 * Owner direction (2026-10-08): Schibsted Grotesk supplies headings, body copy
 * and controls. Instrument Sans stays on long-form blog reading surfaces.
 * Marcellus is reserved for the brand lockup, Caveat for handwritten accents.
 * Role assignments live in palettes.css; latin-ext includes Polish glyphs.
 */
export const schibsted = Schibsted_Grotesk({
  subsets: ['latin', 'latin-ext'],
  weight: 'variable',
  display: 'swap',
  variable: '--font-schibsted',
});

export const instrument = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: 'variable',
  display: 'swap',
  variable: '--font-instrument',
});

export const marcellus = Marcellus({
  // DD3-F11: include latin-ext for Polish diacritics (ą, ć, ł, ń, ś, ż, ź) — was rendering
  // via WOFF2 fallback unicode-range, causing FOIT flash on first character.
  subsets: ['latin', 'latin-ext'],
  weight: '400',
  display: 'swap',
  variable: '--font-marcellus',
});

export const caveat = Caveat({
  // DD3-F11: latin-ext for PL diacritics (accent font shows up in fontAccent class on
  // hero headings — first impression matters).
  subsets: ['latin', 'latin-ext'],
  weight: '600',
  display: 'swap',
  // CWV 2026-07-08: Caveat NIE renderuje LCP zadnej strony statycznej (hero
  // headline uses Schibsted Grotesk through --font-heading; .fontAccent/Caveat zyje na ekranach /app za
  // auth). Preload na kazdej stronie kradl pasmo krytycznej sciezki LCP
  // (2 pliki woff2). display:swap pokrywa on-demand load w /app.
  preload: false,
  variable: '--font-caveat',
});

/**
 * Klasy ze zmiennymi fontów — jedna wartość dla `<html>` (`_document.tsx`).
 * Kolejność bez znaczenia: każda klasa deklaruje własną zmienną.
 */
export const FONT_VARIABLE_CLASSNAMES = `${schibsted.variable} ${instrument.variable} ${marcellus.variable} ${caveat.variable}`;
