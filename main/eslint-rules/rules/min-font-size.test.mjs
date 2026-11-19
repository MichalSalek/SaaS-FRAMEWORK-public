// @vitest-environment node
import guard from './min-font-size.mjs';
import { createRuleTester } from '../rule-tester.mjs';

// .ts/.tsx samples of the retired tests/audit/_fixtures/min-font-size (same verdicts; stylesheet
// samples are in css-rules/rules/min-font-size.test.mjs).
const FIXTURES = {
  'must-fail': {
    'inline-fontsize.tsx':
      "export const Probe = () => (\n  <span style={{ fontSize: 13, color: 'red' }}>13</span>\n);\n",
    'inline-quoted-percent.tsx':
      "// Ten sam zapis procentem: liczy się od rodzica, więc daje inny px w każdym\n// kontekście, a w cudzysłowie był dla skanu niewidzialny.\nexport const Probe = () => <span style={{ fontSize: '85%' }}>85</span>;\n",
    'inline-quoted-px.tsx':
      "// Rozmiar inline w CUDZYSŁOWIE. Gałąź inline wymagała gołej cyfry zaraz po\n// dwukropku, a gałąź cudzysłowowa akceptowała wyłącznie em/rem — więc ten\n// zapis, żywy idiom builderów kart OG, przechodził na zielono.\nexport const Probe = () => <span style={{ fontSize: '12px' }}>12</span>;\n",
    'inline-relative.tsx':
      "export const Probe = () => (\n  <span style={{ fontSize: '0.9em' }}>relatywny inline</span>\n);\n",
    'og-builder.ts':
      "// Plik .ts BEZ JSX-a: buildery kart OG składają drzewo przez\n// React.createElement, więc raw px mieszka w zwykłym module TypeScriptu.\n// Rozszerzenie skanu o *.ts nie miało żadnej próbki — jego usunięcie\n// przechodziło przez meta-strażnika bezgłośnie.\nexport const captionStyle = {\n  fontSize: 12,\n  letterSpacing: '0.02em',\n};\n",
  },
  'must-pass': {
    'inline-ok.tsx':
      'export const Probe = () => (\n  <>\n    <span style={{ fontSize: 16 }}>floor</span>\n    <span style={{ fontSize: 20 }}>powyzej</span>\n  </>\n);\n',
    'inline-quoted-ok.tsx':
      "// Zapis w cudzysłowie POWYŻEJ floora — dokładnie to, co robią buildery kart\n// OG (wszystkie wartości >= 20px). Zaostrzenie nie może ich ruszyć.\nexport const Probe = () => (\n  <>\n    <span style={{ fontSize: '20px' }}>floor z zapasem</span>\n    <span style={{ fontSize: '100%' }}>pełny rozmiar rodzica</span>\n    <span style={{ fontSize: '160px' }}>nagłówek karty OG</span>\n  </>\n);\n",
    'og-builder-ok.ts':
      "// Bliźniak próbki must-fail, tyle że zgodny z floorem: plik .ts wchodzi\n// w zakres skanu, ale sam w sobie nie jest naruszeniem.\nexport const headingStyle = {\n  fontSize: '28px',\n  fontWeight: 700,\n};\n",
  },
};

const tsx = createRuleTester({ jsx: true });
const ts = createRuleTester();
const at = name => `src/UI/features/fixture/${name}`;
const fixture = (verdict, jsxOn) =>
  Object.entries(FIXTURES[verdict])
    .filter(([name]) => name.endsWith('.tsx') === jsxOn)
    .map(([name, code]) =>
      verdict === 'must-fail'
        ? { code, filename: at(name), errors: 1 }
        : { code, filename: at(name) }
    );
const inline = [{ messageId: 'inline' }];
const css = [{ messageId: 'css' }];

tsx.run('nf/min-font-size (tsx)', guard.rule, {
  valid: [
    ...fixture('must-pass', true),
    {
      code: 'const a = <span style={{ fontSize: 16, fontWeight: 12 }} />;',
      filename: 'src/UI/a.tsx',
    },
    {
      code: "const a = <span style={{ fontSize: 'var(--text-xs)' }} />;",
      filename: 'src/UI/a.tsx',
    },
    {
      code: "const a = <span style={{ fontSize: big ? 20 : '1.25rem' }} />;",
      filename: 'src/UI/a.tsx',
    },
    // prose: comments never count, and a font-size text without a CSS colon is not CSS
    {
      code: '// fontSize: 12\n/* font-size: 11px */\nconst a = <b style={{ fontSize: 18 }} />;',
      filename: 'src/UI/a.tsx',
    },
    { code: "const s = 'set font-size to 11px';", filename: 'src/UI/a.tsx' },
    // the /dev pages are no longer grandfathered, but legal code there stays legal
    {
      code: 'const a = <div style={{ fontSize: 16 }} />;',
      filename: 'src/pages/dev/ui.tsx',
    },
  ],
  invalid: [
    ...fixture('must-fail', true),
    {
      code: 'const a = <span style={{ fontSize: 15 }} />;',
      filename: 'src/UI/a.tsx',
      errors: inline,
    },
    {
      code: "const a = <span style={{ 'fontSize': '0.875rem' }} />;",
      filename: 'src/UI/a.tsx',
      errors: inline,
    },
    {
      code: 'const a = <span style={{ fontSize: `9px` }} />;',
      filename: 'src/UI/a.tsx',
      errors: inline,
    },
    {
      code: 'const a = <span style={{ fontSize: big ? 20 : 12 }} />;',
      filename: 'src/UI/a.tsx',
      errors: inline,
    },
    {
      code: "const a = <span style={{ fontSize: 'clamp(12px, 1vw, 20px)' }} />;",
      filename: 'src/UI/a.tsx',
      errors: inline,
    },
    {
      code: 'const a = <span style={{ fontSize: 12 as const }} />;',
      filename: 'src/UI/a.tsx',
      errors: inline,
    },
    {
      code: 'const a = <style>{`.x { font-size: 12px; }`}</style>;',
      filename: 'src/UI/a.tsx',
      errors: css,
    },
    {
      code: 'const a = <div style={{ fontSize: 12 }} />;',
      filename: 'src/pages/dev/architecture.tsx',
      errors: inline,
    },
  ],
});

ts.run('nf/min-font-size (ts)', guard.rule, {
  valid: [
    ...fixture('must-pass', false),
    {
      code: 'const html = `<p style="font-size: 16px">${x}</p>`;',
      filename: 'src/application/email/a.ts',
    },
    { code: 'const n = <number>size;', filename: 'src/application/a.ts' },
  ],
  invalid: [
    ...fixture('must-fail', false),
    {
      code: 'const html = `<p style="font-size: 13px">${x}</p>`;',
      filename: 'src/application/email/a.ts',
      errors: css,
    },
    {
      code: "const rule = 'font-size: .8em';",
      filename: 'src/application/a.ts',
      errors: css,
    },
    {
      code: "const s = { fontSize: '85%' };",
      filename: 'src/application/a.ts',
      errors: inline,
    },
  ],
});
