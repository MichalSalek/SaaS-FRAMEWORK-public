// @vitest-environment node
import guard from './batch-locale-discipline.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const file = 'src/domain/email/operations/send.ts';
const error = [{ messageId: 'inline' }];

tester.run('nf/batch-locale-discipline', guard.rule, {
  valid: [
    {
      code: `const q = { where: { created_by_user_id: id } };`,
      filename: file,
    },
    {
      code: `// distinct: ['created_by_user_id']\nconst q = {};`,
      filename: file,
    },
    { code: `const q = { distinct: ['id'] };`, filename: file },
    {
      code: `const note = "distinct: ['created_by_user_id']";`,
      filename: file,
    },
  ],
  invalid: [
    {
      code: `const q = { distinct: ['created_by_user_id'] };`,
      filename: file,
      errors: error,
    },
    {
      code: `const q = {\n  distinct: [\n    'created_by_user_id',\n  ],\n};`,
      filename: file,
      errors: error,
    },
    {
      code: `const q = { distinct: ['created_by_user_id'] as const };`,
      filename: file,
      errors: error,
    },
    {
      code: `const q = {\n  distinct:\n    ['created_by_user_id'],\n};`,
      filename:
        'src/application/email-handler/lifecycle/email-locale-batch.resolver.ts',
      errors: error,
    },
  ],
});
