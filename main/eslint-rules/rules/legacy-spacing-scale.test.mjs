// @vitest-environment node
import guard from './legacy-spacing-scale.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const file = 'src/UI/features/x/a.tsx';
const legacy = [{ messageId: 'legacy' }];

tester.run('nf/legacy-spacing-scale', guard.rule, {
  valid: [
    { code: "const s = { padding: 'var(--space-8)' };", filename: file },
    {
      code: 'const a = <div style={{ gap: `var(--space-${n})` }} />;',
      filename: file,
    },
    // prose: the removed scale named in a comment does not count
    {
      code: '// was var(--sp-2)\n/* var(--sp-1) */\nconst x = 1;',
      filename: file,
    },
    { code: "const s = { margin: 'var(--sp-x)' };", filename: file },
  ],
  invalid: [
    {
      code: "const s = { padding: 'var(--sp-2)' };",
      filename: file,
      errors: legacy,
    },
    {
      code: 'const a = <div style={{ margin: `0 var(--sp-3)` }} />;',
      filename: file,
      errors: legacy,
    },
    {
      code: 'const a = <div style={{ margin: `${x} var(--sp-0)` }} />;',
      filename: file,
      errors: legacy,
    },
    {
      code: 'const css = `.x { gap: var(--sp-9); }`;',
      filename: file,
      errors: legacy,
    },
  ],
});
