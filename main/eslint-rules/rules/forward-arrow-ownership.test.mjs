// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import guard, { PRIMITIVES } from './forward-arrow-ownership.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(
  HERE,
  '../../../tests/audit/_fixtures/forward-arrow-ownership'
);
const tester = createRuleTester({ jsx: true });
const file = name => `src/UI/features/fixture/${name}`;
const code = rel => readFileSync(path.join(FIXTURES, rel), 'utf8');
const hand = [{ messageId: 'hand' }];

describe('discovery', () => {
  it('finds the button primitives that take direction', () => {
    expect([...PRIMITIVES].sort()).toEqual(['ButtonAtom', 'LinkButtonAtom']);
  });
});

tester.run('nf/forward-arrow-ownership', guard.rule, {
  valid: [
    {
      code: code('must-pass/documented-exception/Step.tsx'),
      filename: file('Step.tsx'),
    },
    {
      code: code('must-pass/icon-only/Pager.tsx'),
      filename: file('Pager.tsx'),
    },
    {
      code: code('must-pass/other-component/Row.tsx'),
      filename: file('Row.tsx'),
    },
    {
      code: code('must-pass/prose-and-strings/Docs.tsx'),
      filename: file('Docs.tsx'),
    },
    {
      code: `import { ArrowUpRightIcon } from '@phosphor-icons/react';\nimport { ButtonAtom } from './Button.atom';\nexport const A = () => <ButtonAtom icon={<ArrowUpRightIcon />}>X</ButtonAtom>;`,
      filename: file('Up.tsx'),
    },
    {
      code: `import { ButtonAtom } from './Button.atom';\nexport const A = () => <ButtonAtom direction="forward">Dalej</ButtonAtom>;`,
      filename: file('Ok.tsx'),
    },
  ],
  invalid: [
    {
      code: code('must-fail/icon-prop/Step.tsx'),
      filename: file('icon.tsx'),
      errors: hand,
    },
    {
      code: code('must-fail/multiline-aliased/Step.tsx'),
      filename: file('alias.tsx'),
      errors: hand,
    },
    {
      code: code('must-fail/ternary-in-prop/Step.tsx'),
      filename: file('ternary.tsx'),
      errors: hand,
    },
    {
      code: code('must-fail/arrow-in-label/Step.tsx'),
      filename: file('label.tsx'),
      errors: hand,
    },
    {
      code: code('must-fail/bare-escape-marker/Step.tsx'),
      filename: file('bare.tsx'),
      errors: hand,
    },
  ],
});
