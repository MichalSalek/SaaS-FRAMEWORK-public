// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './ink-focus-ring.mjs';
import { lintCss } from '../test-utils.mjs';

const FILE = 'src/UI/features/fixture/x.module.css';
const lint = css => lintCss(rule, { [FILE]: css });

// Retired fixtures (tests/audit/_fixtures/ink-focus-ring), verbatim.
const MUST_FAIL = [
  // alias-camelcase.module.css
  ':root {\n  --inkBand: oklch(0.46 0.1 288);\n}\n\n.camelAliasNoRemap {\n  background: var(--inkBand);\n  color: #ffffff;\n}\n',
  // alias-dark-band.module.css
  ':root {\n  --band: oklch(0.46 0.1 288);\n}\n\n.aliasBandNoRemap {\n  background: var(--band);\n  color: #ffffff;\n}\n',
  // empty-escape.module.css
  '.emptyEscape {\n  /* focus-ring-allow: */\n  background: var(--color-ink);\n}\n',
  // footer-bg-no-remap.module.css
  '.footerNoRemap {\n  background: var(--footer-bg);\n}\n',
  // gold-band-no-remap.module.css
  '.goldBandNoRemap {\n  width: 100vw;\n  margin-left: calc(50% - 50vw);\n  background: var(--color-primary);\n}\n',
  // ink-band-role-no-remap.module.css
  '/* Pas fioletowy przez ROLĘ palety (nie przez lokalny alias) bez remapu ringu.\n   Ta próbka pilnuje, żeby promocja wartości z modułu do palettes.css nie\n   oślepiła strażnika: gałąź "ciemny pas przez alias" rozwiązuje jeden skok\n   w tym samym pliku i po przeniesieniu wartości przestałaby ten pas widzieć. */\n.violetBandNoRemap {\n  background: var(--color-ink-band);\n  color: var(--color-on-ink-band);\n}\n',
  // ink-no-remap.module.css
  '.inkNoRemap {\n  background: var(--color-ink);\n  color: var(--color-on-ink);\n}\n',
  // ink-remap-on-primary.module.css
  '/* Remap JEST, ale na zlej wartosci: po wymianie palety na rouge-papier\n   --color-primary to ciemna czerwien (L 0.565) i daje na atramencie 3,6:1.\n   Rola dla negatywu to --color-accent-on-ink (DECISION S106). */\n.inkRemapOnPrimary {\n  background: var(--color-ink);\n  --color-focus-ring: var(--color-primary);\n  color: var(--color-on-ink);\n}\n',
  // photo-overlay-no-remap.module.css
  '/* Ciemny dysk kontrolki lezacy na cudzej bitmapie: hostuje fokus, wiec\n   musi przemapowac pierscien. Bramka kontrastu tego NIE zobaczy — tlem\n   jest obraz, a nie token powierzchni. */\n.heartButton {\n  background: var(--color-photo-overlay);\n  color: var(--color-on-photo-overlay);\n}\n',
  // selection-accent-on-ink.module.css
  '.selectionPinkRing {\n  background: var(--color-text-primary);\n  color: var(--color-bg-main);\n  --color-focus-ring: var(--color-accent-on-ink);\n}\n',
  // selection-no-remap.module.css
  '.selectionNoRemap {\n  background: var(--color-text-primary);\n  color: var(--color-bg-main);\n}\n',
];
const MUST_PASS = [
  // alias-light-band.module.css
  ':root {\n  --lightBand: oklch(0.97 0.01 90);\n}\n\n.lightBandOk {\n  background: var(--lightBand);\n  color: #1c1c20;\n}\n',
  // dark-block.module.css
  ":root[data-mode='dark'] .band {\n  background: var(--color-ink);\n}\n",
  // escape-with-reason.module.css
  '.band {\n  /* focus-ring-allow: sam jest przyciskiem, ring rysuje sie poza nim */\n  background: var(--color-ink);\n}\n',
  // gold-badge-not-band.module.css
  '.badge {\n  background: var(--color-primary);\n  border-radius: 999px;\n}\n',
  // gold-band-ink-ring.module.css
  '/* Złoty/akcentowy PAS ma oczekiwać --color-ink, więc nowa gałąź (celująca\n   w płaszczyzny ciemne) nie może go dotknąć nawet wtedy, gdy ring stoi\n   na --color-primary byłby tu bez sensu — pas remapuje na atrament. */\n.accentBandInkRing {\n  width: 100vw;\n  margin-left: calc(50% - 50vw);\n  background: var(--color-primary);\n  --color-focus-ring: var(--color-ink);\n  color: var(--color-primary-contrast);\n}\n',
  // ink-remap-on-accent.module.css
  '/* Poprawny remap na rolę akcentu na negatywie — ta próbka pilnuje, żeby nowa\n   gałąź nie zaczęła zgłaszać KAŻDEGO remapu na powierzchni atramentowej. */\n.inkRemapOnAccent {\n  background: var(--color-ink);\n  --color-focus-ring: var(--color-accent-on-ink);\n  color: var(--color-on-ink);\n}\n',
  // ink-with-remap.module.css
  '/* Powierzchnia atramentowa z remapem na ROLĘ akcentu na negatywie.\n   BYŁO: var(--color-primary) — poprawne dla wycofanej palety charcoal-gold,\n   gdzie primary było jasnym złotem. Po rouge-papier primary jest ciemną\n   czerwienią (3,6:1 na atramencie), więc ta wartość jest dziś naruszeniem\n   i pilnuje jej must-fail/ink-remap-on-primary. */\n.band {\n  background: var(--color-ink);\n  --color-focus-ring: var(--color-accent-on-ink);\n}\n',
  // media-wrapper-not-plane.module.css
  '@media (hover: hover) {\n  .row:hover {\n    background: var(--row-hover);\n    color: #ffffff;\n  }\n}\n\n:root {\n  --row-hover: oklch(0.3 0.02 288);\n}\n',
  // selection-inside-ring.module.css
  "/* The ring is drawn inside the fill: it takes the selection's own foreground. */\n.selectionInsideRing {\n  background: var(--color-text-primary);\n  color: var(--color-bg-main);\n  --color-focus-ring: var(--color-bg-main);\n}\n\n.selectionInsideRing:focus-visible {\n  outline: 2px solid var(--color-focus-ring);\n  outline-offset: -2px;\n}\n",
  // selection-outside-ring.module.css
  '.selectionOutsideRing {\n  background: var(--color-text-primary);\n  color: var(--color-bg-main);\n  /* focus-ring-allow: the ring is drawn outside the fill (offset 2px), on the\n     surface behind, where the default ring already contrasts. The prose here\n     names --color-accent-on-ink on purpose: a comment is not a declaration. */\n}\n',
  // warning-band-light.module.css
  '/* Pas OSTRZEGAWCZY jest jasny (L 0.78) — bazowy atramentowy ring trzyma sie\n   na nim sam, wiec ta rola celowo NIE jest ciemna plaszczyzna. */\n.warningStrip {\n  background: var(--color-banner-warning);\n  color: var(--color-on-banner-warning);\n}\n',
];

describe('css/ink-focus-ring', () => {
  it('rejects every retired must-fail fixture once', () => {
    for (const css of MUST_FAIL) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('accepts every retired must-pass fixture', () => {
    for (const css of MUST_PASS) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('names the plane and the wrong value in the message', () => {
    expect(
      lint(
        '.a { background: var(--color-ink); --color-focus-ring: var(--color-primary); }'
      ).findings[0].message
    ).toContain('--color-primary');
    expect(
      lint('.a { background: var(--color-text-primary); }').findings[0].message
    ).toContain('[selection]');
    expect(
      lint('.a { width: 100vw; background: var(--color-primary); }').findings[0]
        .message
    ).toContain('[gold band]');
  });
  it('rejects spellings the line scanner missed: background-color, !important, one-line, nesting', () => {
    for (const css of [
      '.a { background-color: var(--color-ink); }',
      '.a { background: var(--color-ink) !important; }',
      '.a{background:var(--color-ink)}',
      '.a { background: var( --color-banner-critical ); }',
      '@media (min-width: 768px) { .a { background: var(--color-ink); } .b { --color-focus-ring: var(--color-accent-on-ink); } }',
      '.card { color: red; & .band { background: var(--color-photo-overlay-strong); } }',
      ':root { --b: #1a1a1a; }\n.a { background-color: var(--b); color: white; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('accepts a remap inherited from a nesting parent, prose, dark mode and an escape above an enclosing block', () => {
    for (const css of [
      '.card { --color-focus-ring: var(--color-accent-on-ink); & .band { background: var(--color-ink); } }',
      '/* background: var(--color-ink); */ .a { color: red; }',
      ".a::after { content: 'background: var(--color-ink);'; }",
      "[data-mode='dark'] .a { background: var(--color-ink); }",
      '[data-mode=dark] { & .a { background: var(--color-ink); } }',
      '/* focus-ring-allow: decorative overlay only */\n@media (hover: hover) { .a { background: var(--color-ink); } }',
      '.a { background: var(--color-ink, black); }',
      '.a { background: var(--color-surface); color: red; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('fails the presence floor on a tree without backgrounds', () => {
    const result = lintCss(
      rule,
      { 'src/UI/styles/themes/palettes.css': '', [FILE]: '.a{color:red}' },
      { measured: true }
    );
    expect(result.errors.join()).toContain('floor');
  });
  it('fails when the palette stops defining a role the plane list names', () => {
    const roles = [
      '--color-ink',
      '--color-ink-band',
      '--color-ink-band-strong',
      '--color-banner-critical',
      '--color-photo-overlay',
      '--color-photo-overlay-strong',
      '--color-text-primary',
      '--color-primary',
      '--color-accent-on-ink',
      '--color-bg-main',
    ];
    const full = `:root { ${roles.map(r => `${r}: red;`).join(' ')} }`;
    const palette = 'src/UI/styles/themes/palettes.css';
    const ok = lintCss(rule, { [palette]: full, [FILE]: '.a{}' });
    expect(ok.errors.join()).not.toContain('no longer defines');
    const renamed = full.replace('--color-ink-band:', '--color-band-ink:');
    expect(
      lintCss(rule, { [palette]: renamed, [FILE]: '.a{}' }).errors.join()
    ).toContain('--color-ink-band');
  });
});
