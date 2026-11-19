// @vitest-environment node
import guard from './no-sparkle.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const f = 'src/UI/features/fixture/Mark.tsx';
const error = [{ messageId: 'banned' }];

tester.run('nf/no-sparkle', guard.rule, {
  valid: [
    {
      code: `// the ratchet blocks StarIcon and SparkleIcon\nconst a = 1;`,
      filename: f,
    },
    {
      code: `import { PushPinIcon } from '@phosphor-icons/react';\nconst a = <PushPinIcon />;`,
      filename: f,
    },
    { code: `const iconName = 'Pin';`, filename: f },
    { code: `const a = <span>ocena 4/5</span>;`, filename: f },
  ],
  invalid: [
    {
      code: `import { SparkleIcon } from '@phosphor-icons/react';\nconst a = <SparkleIcon />;`,
      filename: f,
      errors: [error[0], error[0]],
    },
    { code: `const StarSvg = () => null;`, filename: f, errors: error },
    {
      code: `const row = { iconName: 'Sparkle' };`,
      filename: f,
      errors: error,
    },
    { code: `const a = <span>⭐</span>;`, filename: f, errors: error },
    { code: `const d = 'M40 8 L43 36 L72 40';`, filename: f, errors: error },
    { code: 'const d = `L72 18 L78 20`;', filename: f, errors: error },
  ],
});
