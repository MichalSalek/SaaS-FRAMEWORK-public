// @vitest-environment node
import guard from './shape-inline-radius.mjs';
import { createRuleTester } from '../rule-tester.mjs';

// TSX samples of the retired tests/audit/_fixtures/shape-tokens (same verdicts; stylesheet samples
// are in css-rules/rules/shape-tokens.test.mjs).
const FIXTURES = {
  'must-fail': {
    'inline-radius.tsx':
      'export function Bar() {\n  return <span style={{ width: 70, height: 22, borderRadius: 9999 }} />;\n}\n',
  },
  'must-pass': {
    'inline-radius-token.tsx':
      "export function Spin() {\n  return <span style={{ width: 28, height: 28, borderRadius: 'var(--style-radius-round)' }} />;\n}\n",
  },
};

const tester = createRuleTester({ jsx: true });
const at = name => `src/UI/features/fixture/${name}`;
const literal = [{ messageId: 'literal' }];

tester.run('nf/shape-inline-radius', guard.rule, {
  valid: [
    ...Object.entries(FIXTURES['must-pass']).map(([name, code]) => ({
      code,
      filename: at(name),
    })),
    {
      code: "const s = { borderRadius: 'var(--style-radius-pill)' };",
      filename: 'src/UI/a.tsx',
    },
    { code: 'const s = { borderRadius: radius };', filename: 'src/UI/a.tsx' },
    { code: 'const s = { borderRadius: `${r}px` };', filename: 'src/UI/a.tsx' },
    // prose: comments and unrelated strings never count
    {
      code: "// borderRadius: 8\n/* borderRadius: '8px' */\nconst s = 'borderRadius: 8px';",
      filename: 'src/UI/a.tsx',
    },
    // escape with a reason on the line or up to three lines above
    {
      code: '// shape-allow: drawn phone bezel\n\n\nconst s = { borderRadius: 44 };',
      filename: 'src/UI/a.tsx',
    },
    {
      code: 'const s = { borderRadius: 44 }; // shape-allow: drawn phone bezel',
      filename: 'src/pages/a.tsx',
    },
  ],
  invalid: [
    ...Object.entries(FIXTURES['must-fail']).map(([name, code]) => ({
      code,
      filename: at(name),
      errors: literal,
    })),
    {
      code: "const s = { borderRadius: '8px' };",
      filename: 'src/UI/a.tsx',
      errors: literal,
    },
    {
      code: "const s = { 'borderRadius': '50%' };",
      filename: 'src/pages/a.tsx',
      errors: literal,
    },
    {
      code: 'const s = { borderRadius: 0 };',
      filename: 'src/UI/a.tsx',
      errors: literal,
    },
    {
      code: 'const s = { borderRadius: on ? 12 : 0 };',
      filename: 'src/UI/a.tsx',
      errors: literal,
    },
    {
      code: 'const s = { borderRadius: 8 as const };',
      filename: 'src/UI/a.tsx',
      errors: literal,
    },
    {
      code: '// shape-allow: far away\n\n\n\nconst s = { borderRadius: 44 };',
      filename: 'src/UI/a.tsx',
      errors: literal,
    },
    {
      code: '// shape-allow:\nconst s = { borderRadius: 44 };',
      filename: 'src/UI/a.tsx',
      errors: [{ messageId: 'bare' }],
    },
  ],
});
