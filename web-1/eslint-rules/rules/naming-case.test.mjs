// @vitest-environment node
import guard from './naming-case.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const code = 'export const a = 1;';
const file = [{ messageId: 'file' }];

tester.run('nf/naming-case', guard.rule, {
  valid: [
    { filename: '/w/src/application/db/lock-rows.ts', code },
    {
      filename: '/w/src/domain/gallery/operations/gallery-pin.operations.ts',
      code,
    },
    { filename: '/w/src/domain/_shared/guards/account-guards.ts', code },
    { filename: '/w/src/application/db/lock-rows.test.ts', code },
    { filename: '/w/src/domain/x/v2-thing.ts', code },
    // outside the root, React components, declarations
    { filename: '/w/src/pages/api/fooBar.ts', code },
    { filename: '/w/src/domain/x/Component.tsx', code },
    { filename: '/w/src/application/types/Env.d.ts', code },
  ],
  invalid: [
    { filename: '/w/src/application/foo/myHelper.ts', code, errors: file },
    { filename: '/w/src/domain/x/Thing.operations.ts', code, errors: file },
    { filename: '/w/src/domain/x/myThing.test.ts', code, errors: file },
    { filename: '/w/src/domain/x/my_thing.ts', code, errors: file },
    { filename: '/w/src/domain/x/my--thing.ts', code, errors: file },
    {
      filename: '/w/src/domain/myDir/thing.ts',
      code,
      errors: [{ messageId: 'directory' }],
    },
    {
      filename: '/w/src/application/Some_Dir/badName.ts',
      code,
      errors: [{ messageId: 'directory' }, { messageId: 'file' }],
    },
  ],
});
