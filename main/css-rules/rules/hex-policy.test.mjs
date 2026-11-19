// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './hex-policy.mjs';
import { lintCss } from '../test-utils.mjs';

// Samples of the retired tests/audit/_fixtures/hex-policy (same verdicts), inlined so the suite
// outlives the fixture directory.
const FIXTURES = {
  'must-fail': {
    'brand-hex-in-data-uri.module.css':
      '/* Kolor marki zamrozony w data-URI: var() tam nie dziala, wiec wymiana palety\n   nigdy tego nie ruszy — dokladnie tak przezyly zlote numeraly. */\n.icon {\n  background: url("data:image/svg+xml,%3Csvg fill=\'%23d9a441\'%3E%3C/svg%3E");\n}\n',
    'double-encoded-brand-hex.module.css':
      '/* Podwojnie zakodowany `#` (%2523): jedno dodatkowe kodowanie wystarczalo,\n   zeby przemycic kolor marki obok bramki. */\n.icon {\n  background: url("data:image/svg+xml,%3Csvg fill=\'%2523d9a441\'%3E%3C/svg%3E");\n}\n',
    'named-css-color.module.css':
      '/* Nazwa CSS jako cala wartosc deklaracji. */\n.icon {\n  color: white;\n}\n',
    'raw-hex.module.css': '.rawHexFill {\n  color: #c13584;\n}\n',
    'raw-oklch.module.css':
      '/* Surowy literal oklch poza systemem tokenow — do S109 ten straznik\n   pilnowal wylacznie zapisu #hex i takiego koloru NIE WIDZIAL. */\n.rawOklchFill {\n  background: oklch(78% 0.17 85);\n}\n',
    'raw-rgba.module.css':
      '/* Zaslona modala jako surowy rgba — do S110 straznik tego nie widzial. */\n.backdrop {\n  background: rgba(0, 0, 0, 0.5);\n}\n',
  },
  'must-pass': {
    'color-mix-anchor.module.css':
      '/* KOTWICA w color-mix zostaje legalna — udokumentowany idiom repo\n   (wlosowe linie i tinty na ciemnym tle). To nie jest wartosc samodzielna. */\n.hairline {\n  border-color: color-mix(in oklch, white 16%, transparent);\n  background: color-mix(in oklch, black 22%, var(--color-ink));\n}\n',
    'named-local-var.module.css':
      '/* Nazwany lokalny token jest dozwolonym zapisem koloru funkcjonalnego. */\n.page {\n  --brand-ig: #c13584;\n  --note-main: oklch(0.86 0.15 95);\n}\n',
    'neutral-hex-variants.module.css':
      '/* Biel i czern w kazdej dlugosci zapisu, takze z alfa, oraz FRAGMENT url()\n   (nazwa filtra SVG), ktory kolorem nie jest. */\n.a {\n  background: url("data:image/svg+xml,%3Csvg fill=\'%23FFFF\'%3E%3C/svg%3E");\n}\n.b {\n  background: url("data:image/svg+xml,%3Csvg fill=\'%23000000ff\'%3E%3C/svg%3E");\n}\n.c {\n  filter: url(%23noiseFilter);\n}\n.d {\n  filter: url(%23feed);\n}\n',
    'parametrized-hsl.module.css':
      '/* Parametryzowany hsl — przepis na kolor z danych, nie literal. */\n.confetti {\n  background: hsl(var(--hue), 80%, 60%);\n}\n',
    'parametrized-oklch.module.css':
      '/* Parametryzowany oklch ZOSTAJE legalny: to przepis na kolor per uzytkownik\n   (deterministyczny hue awatara), a nie literal koloru. */\n.avatar {\n  background: oklch(0.86 0.075 var(--avatar-hue, 0));\n}\n',
    'role-tokens-only.module.css':
      '/* Kolory wylacznie przez role; `in oklch` to przestrzen mieszania,\n   nie literal — straznik nie moze tego mylic. */\n.band {\n  background: var(--color-ink-band);\n  color: color-mix(in oklch, var(--color-on-ink-band) 78%, transparent);\n}\n',
    'structural-hex-in-data-uri.module.css':
      '/* Neutralna biel/czern w data-URI zostaje legalna: to koniecznosc techniczna,\n   bo SVG w URL nie widzi kaskady CSS. */\n.chevron {\n  background: url("data:image/svg+xml,%3Csvg stroke=\'%23ffffff\'%3E%3C/svg%3E");\n  mask: url("data:image/svg+xml,%3Csvg fill=\'%23000\'%3E%3C/svg%3E");\n}\n',
  },
};

const at = 'src/UI/features/fixture/a.module.css';
const lint = css => lintCss(rule, { [at]: css });

describe('css/hex-policy', () => {
  it('keeps the verdicts of the retired fixtures', () => {
    for (const [file, css] of Object.entries(FIXTURES['must-fail'])) {
      expect(lint(css).findings.length, file).toBeGreaterThan(0);
    }
    for (const [file, css] of Object.entries(FIXTURES['must-pass'])) {
      expect(lint(css).findings, file).toHaveLength(0);
    }
  });
  it('rejects every raw colour shape', () => {
    for (const css of [
      '.a { color: #ec4899; }',
      '.a { background: color-mix(in oklch, #facc15 20%, transparent); }',
      '.a { border: 1px solid rgb(10 20 30); }',
      '.a { fill: hsla(200, 50%, 50%, 0.4); }',
      '.a { color: BLACK !important; }',
      '.a { background: oklch(0.5 0.1 20), var(--x); }',
      '.a {\n  box-shadow:\n    0 0 0 1px #abc;\n}',
      '.a { color: #abc } .b { --ok: #abc; }',
      '@media print { .a { color: #000; } }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('ignores comments, strings and custom-property definitions', () => {
    for (const css of [
      '/* color: #ec4899; */ .a { color: var(--color-ink); }',
      '.a { color: var(--color-ink); /* was #ec4899 */ }',
      ".a::after { content: '#1 white'; }",
      '.a { --hue: oklch(0.5 0.1 20); --ig: #c13584; }',
      '.a { color: color-mix(in oklch, var(--ig) 80%, black); }',
      '#feed { color: var(--color-ink); }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('exempts a live allowlisted sheet and fails a dead entry', () => {
    const legal = 'src/UI/features/static/LegalDocLayout.module.css';
    const live = lintCss(rule, {
      [legal]: '@media print { .a { color: #000; } }',
    });
    expect(live.findings).toHaveLength(0);
    expect(live.errors.join()).not.toContain('holds no raw colour');
    expect(
      lintCss(rule, {
        [legal]: '.a { color: var(--color-ink); }',
      }).errors.join()
    ).toContain('holds no raw colour');
  });
  it('fails the presence floor over a tree without colours', () => {
    const files = {
      'src/UI/features/static/LegalDocLayout.module.css': '.a{color:#000}',
      'src/UI/features/explore/components/ExploreStylistsTab.module.css':
        '.a{color:#c13584}',
      'src/UI/features/static/HelpCenterPage.module.css': '.a{color:#000}',
      'src/a.css': '.a{margin:0}',
    };
    expect(lintCss(rule, files, { measured: true }).errors.join()).toContain(
      'floor'
    );
  });
});
