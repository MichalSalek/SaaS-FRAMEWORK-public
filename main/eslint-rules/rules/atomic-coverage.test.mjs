// @vitest-environment node
import guard from './atomic-coverage.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const missing = [{ messageId: 'missing' }];
const mismatch = [{ messageId: 'mismatch' }];

tester.run('nf/atomic-coverage', guard.rule, {
  valid: [
    {
      code: `export function FooAtom() { return null; }`,
      filename: 'src/UI/components/Foo/Foo.atom.tsx',
    },
    {
      code: `const BarMolecule = () => null;\nexport { BarMolecule };`,
      filename: 'src/UI/components/Bar/Bar.molecule.tsx',
    },
    {
      code: `export function useFoo() { return 1; }`,
      filename: 'src/UI/hooks/useFoo.tsx',
    },
    {
      code: `export const FEATURES = [];`,
      filename: 'src/UI/features/static/GetAppPageFeatures.tsx',
    },
    {
      code: `export const helper = 1;`,
      filename: 'src/UI/components/Foo/foo.utils.tsx',
    },
    {
      code: `// export function FooAtom\nexport function FooAtom() { return null; }`,
      filename: 'src/UI/components/Foo/Foo.atom.tsx',
    },
  ],
  invalid: [
    {
      code: `export function Foo() { return null; }`,
      filename: 'src/UI/components/Foo/Foo.tsx',
      errors: missing,
    },
    {
      code: `export function Foo() { return null; }`,
      filename: 'src/UI/components/Foo/Foo.atom.tsx',
      errors: mismatch,
    },
    {
      code: `const note = 'export function FooAtom';\nexport function Foo() { return null; }`,
      filename: 'src/UI/components/Foo/Foo.atom.tsx',
      errors: mismatch,
    },
  ],
});
