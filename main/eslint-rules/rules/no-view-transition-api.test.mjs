// @vitest-environment node
import guard from './no-view-transition-api.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const start = [{ messageId: 'start' }];
const flush = [{ messageId: 'flush' }];

tester.run('nf/no-view-transition-api', guard.rule, {
  valid: [
    {
      code: `// document.startViewTransition was removed\nconst a = 1;`,
      filename: 'src/UI/layouts/Shell.tsx',
    },
    {
      code: `import { flushSync } from 'react-dom';`,
      filename: 'src/UI/features/gallery/Upload.tsx',
    },
    {
      code: `import { flushSync } from 'react-dom';\nflushSync(() => {});`,
      filename: 'src/UI/layouts/Shell.test.tsx',
    },
  ],
  invalid: [
    {
      code: `document.startViewTransition(() => {});`,
      filename: 'src/application/routing/nav.ts',
      errors: start,
    },
    {
      code: `const name = 'startViewTransition';`,
      filename: 'src/UI/features/home/Home.tsx',
      errors: start,
    },
    {
      code: `import { flushSync } from 'react-dom';\nflushSync(() => {});`,
      filename: 'src/application/stores/navigation.store.ts',
      errors: [flush[0], flush[0]],
    },
  ],
});
