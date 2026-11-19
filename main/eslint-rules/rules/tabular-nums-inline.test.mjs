// @vitest-environment node
import guard from './tabular-nums-inline.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tsx = createRuleTester({ jsx: true });
const ts = createRuleTester();
const error = [{ messageId: 'tabular' }];
const sample = code => ({
  code,
  filename: 'src/UI/features/fixture/Count.tsx',
});
const tsSample = code => ({
  code,
  filename: 'src/UI/features/fixture/registry.ts',
});

tsx.run('nf/tabular-nums-inline (tsx)', guard.rule, {
  valid: [
    // a documented use: marker on the line above or on the same line
    sample(
      "export const C = () => (\n  // tnum-allow: odometer digits that roll in place\n  <span style={{ fontVariantNumeric: 'tabular-nums' }}>12</span>\n);\n"
    ),
    sample(
      "const s = { fontVariantNumeric: 'tabular-nums' /* tnum-allow: integer column */ };"
    ),
    // prose: comments, a string or template outside the property, the keyword as JSX text
    sample(
      "// <span style={{ fontVariantNumeric: 'tabular-nums' }} />\nexport const C = () => <span />;"
    ),
    sample(
      '/* style={{ fontFeatureSettings: "\'tnum\' 1" }} */\nexport const C = () => <span />;'
    ),
    sample(
      "const s = 'fontVariantNumeric: tabular-nums';\nconst a = <i title={s} />;"
    ),
    sample(
      'const s = `fontVariantNumeric: tabular-nums`;\nconst a = <i title={s} />;'
    ),
    sample('const a = <p>tabular-nums only with a reason</p>;'),
    // other values of the same properties
    sample(
      "const a = <i style={{ fontVariantNumeric: 'lining-nums', fontFeatureSettings: \"'lnum' 1\" }} />;"
    ),
  ],
  invalid: [
    // retired fixture tests/audit/_fixtures/tabular-nums/must-fail/inline-style
    {
      ...sample(
        "export const Count = () => (\n  <span style={{ fontVariantNumeric: 'tabular-nums' }}>12 wpisów</span>\n);\n"
      ),
      errors: error,
    },
    {
      ...sample(
        'const a = <i style={{ fontFeatureSettings: "\'tnum\' 1" }} />;'
      ),
      errors: error,
    },
    {
      ...sample(
        'const a = <i style={{ fontFeatureSettings: `"tnum" on` }} />;'
      ),
      errors: error,
    },
    // through a constant, a ternary, a kebab key, an assignment and setProperty
    {
      ...sample(
        "const st = { fontVariantNumeric: live ? 'tabular-nums' : 'normal' };\nconst a = <i style={st} />;"
      ),
      errors: error,
    },
    {
      ...sample("const st = { 'font-variant-numeric': 'tabular-nums' };"),
      errors: error,
    },
    {
      ...sample("el.style.fontVariantNumeric = 'tabular-nums';"),
      errors: error,
    },
    {
      ...sample("el.style.setProperty('font-feature-settings', \"'tnum' 1\");"),
      errors: error,
    },
    // a bare marker exempts nothing; a marker three lines up is out of reach
    {
      ...sample(
        "// tnum-allow:\nconst a = <i style={{ fontVariantNumeric: 'tabular-nums' }} />;"
      ),
      errors: error,
    },
    {
      ...sample(
        "// tnum-allow: too far\n\n\nconst a = <i style={{ fontVariantNumeric: 'tabular-nums' }} />;"
      ),
      errors: error,
    },
  ],
});

ts.run('nf/tabular-nums-inline (ts)', guard.rule, {
  valid: [
    // retired fixture tests/audit/_fixtures/tabular-nums/must-pass/prose-only (registry.ts)
    tsSample(
      "// A description may NAME the keyword without declaring it.\nexport const description: string =\n  'Liczby danych jadą w sans; tabular-nums tylko z powodem (tnum-allow).';\n"
    ),
    tsSample(
      "const d = { description: 'fontVariantNumeric: tabular-nums is prose here' };"
    ),
  ],
  invalid: [
    {
      ...tsSample(
        "export const style = <const>{ fontVariantNumeric: 'tabular-nums' };"
      ),
      errors: error,
    },
  ],
});
