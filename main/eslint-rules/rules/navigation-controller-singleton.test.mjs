// @vitest-environment node
import guard from './navigation-controller-singleton.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const owner = 'src/UI/layouts/NavigationTransitionController.composition.tsx';
const other = 'src/application/routing/leave-guard.ts';
const error = [{ messageId: 'subscriber' }];

tester.run('nf/navigation-controller-singleton', guard.rule, {
  valid: [
    {
      code: `router.events.on('routeChangeStart', fn);\nrouter.beforePopState(() => true);`,
      filename: owner,
    },
    {
      code: `// routeChangeStart and beforePopState belong to the controller\nconst a = 1;`,
      filename: other,
    },
    {
      code: `router.events.on('routeChangeComplete', fn);`,
      filename:
        'src/UI/layouts/NavigationTransitionController.composition.test.tsx',
    },
  ],
  invalid: [
    {
      code: `router.events.on('routeChangeStart', fn);`,
      filename: other,
      errors: error,
    },
    {
      code: `router.beforePopState(() => true);`,
      filename: other,
      errors: error,
    },
    { code: `beforePopState(() => true);`, filename: other, errors: error },
    {
      code: `router.events.routeChangeStart(fn);`,
      filename: other,
      errors: error,
    },
    {
      code: `const name = 'routeChangeError';`,
      filename: other,
      errors: error,
    },
  ],
});
