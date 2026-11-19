// @vitest-environment node
import guard from './navigation-transition-ssot.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const owner = 'src/UI/layouts/NavigationTransitionController.composition.tsx';
const other = 'src/application/stores/other.ts';
const relic = [{ messageId: 'relic' }];
const write = [{ messageId: 'write' }];

tester.run('nf/navigation-transition-ssot', guard.rule, {
  valid: [
    {
      code: `html.dataset['navPhase'] = 'idle';\ndelete html.dataset.navDirection;`,
      filename: owner,
    },
    {
      code: `// lastHookNavTs and dataset.navPhase live in the comment\nconst a = 1;`,
      filename: other,
    },
    {
      code: `html.dataset['navPhase'] = 'idle';`,
      filename:
        'src/UI/layouts/NavigationTransitionController.composition.test.tsx',
    },
    {
      code: `const shell = <div data-nav-incoming="" />;`,
      filename: 'src/UI/layouts/Shell.tsx',
    },
  ],
  invalid: [
    { code: `const lastHookNavTs = 1;`, filename: other, errors: relic },
    {
      code: `import { open } from './navDirection.store';`,
      filename: owner,
      errors: relic,
    },
    {
      code: `html.dataset['navPolicy'] = 'slide';`,
      filename: other,
      errors: write,
    },
    { code: `html.dataset.navPhase = 'idle';`, filename: other, errors: write },
    {
      code: `el.setAttribute('data-nav-direction', 'back');`,
      filename: other,
      errors: write,
    },
  ],
});
