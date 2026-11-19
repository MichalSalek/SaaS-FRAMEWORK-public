// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './min-font-size.mjs';
import { lintCss } from '../test-utils.mjs';

// Stylesheet samples of the retired tests/audit/_fixtures/min-font-size (same verdicts; the .ts
// and .tsx samples are in eslint-rules/rules/min-font-size.test.mjs).
const FIXTURES = {
  'must-fail': {
    'percent.module.css':
      '/* Procent < 100 = to samo co em, innym zapisem. */\n.note {\n  font-size: 85%;\n}\n',
    'px-just-below-floor.module.css':
      '/* 15px to ostatni rozmiar POD floorem — i akurat ten, który wygląda\n   niewinnie (--text-sm = 15px istnieje w skali, ale jako TOKEN, nie raw px).\n   Bez tej próbki obniżenie floora do 14px przechodziło bez śladu. */\n.meta {\n  font-size: 15px;\n}\n',
    'raw-px.module.css':
      '/* Raw px ponizej floora — klasa pierwotna (badge dzwoneczka, S76). */\n.badge {\n  font-size: 11px;\n}\n',
    'relative-em-no-zero.module.css':
      '/* Ten sam zapis bez wiodacego zera — osobny wektor. */\n.count {\n  font-size: .9em;\n}\n',
    'relative-em.module.css':
      '/* 0.85em na rodzicu --text-sm = 12,75px. Skan px byl na to slepy (S98). */\n.cookieName {\n  font-size: 0.85em;\n}\n',
    'relative-rem.module.css':
      '/* rem omija rodzica, ale nadal omija tez tokeny --text-*. */\n.banner {\n  font-size: 0.875rem;\n}\n',
  },
  'must-pass': {
    'px-at-floor.module.css':
      '/* 16px = dokladnie floor, 18px powyzej — ani jedno nie moze lapac. */\n.atFloor {\n  font-size: 16px;\n}\n\n.above {\n  font-size: 18px;\n}\n\n.big {\n  font-size: 160px;\n}\n',
    'relative-above-one.module.css':
      '/* Swiadome POWIEKSZENIA relatywne (dropcap 4.2em w BlogPostPage) sa legalne —\n   regula tnie wylacznie zapisy < 1. */\n.dropcap::first-letter {\n  font-size: 4.2em;\n}\n\n.hero {\n  font-size: 1.5rem;\n}\n\n.full {\n  font-size: 100%;\n}\n',
    'tokens.module.css':
      '/* Kanon: rozmiar bierze sie z tokenu skali. */\n.label {\n  font-size: var(--text-xs);\n}\n\n.body {\n  font-size: var(--text-base);\n}\n',
  },
};

const lint = (css, file = 'src/UI/features/fixture/a.module.css') =>
  lintCss(rule, { [file]: css });

describe('css/min-font-size', () => {
  it('keeps the verdicts of the retired fixtures', () => {
    for (const [file, css] of Object.entries(FIXTURES['must-fail'])) {
      expect(lint(css).findings.length, file).toBeGreaterThan(0);
    }
    for (const [file, css] of Object.entries(FIXTURES['must-pass'])) {
      expect(lint(css).findings, file).toHaveLength(0);
    }
  });
  it('rejects every raw shape below the floor', () => {
    for (const css of [
      '.a { font-size: 0px; }',
      '.a { font-size:  12.5px; }',
      '.a { font-size: .5px; }',
      '.a { font-size: 99%; }',
      '.a { font-size: 0.99rem !important; }',
      '.a { font-size: clamp(12px, 0.95vw, 14px); }',
      '.a { font-size: min(1.5rem, 0.875rem + 1vw); }',
      '.a { font-size: max(var(--text-base), 10px); }',
      '.a {\n  font-size:\n    11px;\n}',
      '.a { --badge-font-size: 11px; }',
      'body { font-size: 14px; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('accepts tokens, enlargements, prose, strings and the scale sheet', () => {
    for (const css of [
      '.a { font-size: var(--text-xs); }',
      '.a { font-size: clamp(16px, 2vw, 24px); }',
      '.a { font-size: 1em; font-size: 2rem; font-size: 160px; font-size: inherit; }',
      '/* font-size: 11px */ .a { font-size: var(--text-sm); }',
      ".a::after { content: 'font-size: 11px'; }",
      '.a { --text-xs: 14px; line-height: 12px; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
    expect(
      lint('.a { font-size: 14px; }', 'src/UI/styles/tokens.css').findings
    ).toHaveLength(0);
  });
  it('fails the presence floor over a tree without font sizes', () => {
    expect(
      lintCss(
        rule,
        { 'src/UI/styles/tokens.css': ':root{}', 'src/a.css': '.a{color:red}' },
        { measured: true }
      ).errors.join()
    ).toContain('floor');
  });
});
