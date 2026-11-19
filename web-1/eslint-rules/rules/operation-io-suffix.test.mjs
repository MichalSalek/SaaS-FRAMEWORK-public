// @vitest-environment node
import guard from './operation-io-suffix.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const file = '/w/src/domain/gallery/operations/x.operations.ts';
const suffix = [{ messageId: 'suffix' }];

tester.run('nf/operation-io-suffix', guard.rule, {
  valid: [
    {
      filename: file,
      code: 'export const createX_IO = async (id: string): Promise<OperationResult<X, E>> => success(1);',
    },
    {
      filename: file,
      code: 'export async function createX_IO(id: string): Promise<OperationResult<X, E>> { return success(1); }',
    },
    // a pure (synchronous) OperationResult is not an IO operation
    {
      filename: file,
      code: 'export const check = (id: string): OperationResult<X, E> => success(1);',
    },
    // OperationResult only in the body, or no annotation
    {
      filename: file,
      code: 'export const helper = async (id: string): Promise<number> => { const r: OperationResult<X, E> = success(1); return 1; };',
    },
    {
      filename: file,
      code: 'export const inferred = async (id: string) => success(1);',
    },
    // not exported
    {
      filename: file,
      code: 'const local = async (): Promise<OperationResult<X, E>> => success(1);',
    },
    // `export { x as x_IO }` takes the exported name
    {
      filename: file,
      code: 'const createX = async (): Promise<OperationResult<X, E>> => success(1);\nexport { createX as createX_IO };',
    },
    // prose
    {
      filename: file,
      code: '// export const createX = async (): Promise<OperationResult<X, E>> => x\nexport const s = "async (): Promise<OperationResult<X, E>>";\nexport const t = `OperationResult`;',
    },
    // allowlisted entry
    {
      filename: file,
      code: 'export const createX = async (): Promise<OperationResult<X, E>> => success(1);',
      options: [
        { allow: ['src/domain/gallery/operations/x.operations.ts::createX'] },
      ],
    },
  ],
  invalid: [
    {
      filename: file,
      code: 'export const createX = async (id: string): Promise<OperationResult<X, E>> => success(1);',
      errors: suffix,
    },
    {
      filename: file,
      code: 'export async function createX(id: string): Promise<OperationResult<X, E>> { return success(1); }',
      errors: suffix,
    },
    {
      filename: file,
      code: 'export const createX = async (\n  id: string,\n): Promise<\n  OperationResult<X, E>\n> => {\n  return success(1);\n};',
      errors: suffix,
    },
    {
      filename: file,
      code: 'export const createX = async function (): Promise<OperationResult<X, E>> { return success(1); };',
      errors: suffix,
    },
    {
      filename: file,
      code: 'export const createX = (id: string): Promise<OperationResult<X, E>> => run(id);',
      errors: suffix,
    },
    {
      filename: file,
      code: 'export const createX = async (): Promise<Kernel.OperationResult<X, E>> => success(1);',
      errors: suffix,
    },
    {
      filename: file,
      code: 'export const createX: (id: string) => Promise<OperationResult<X, E>> = async id => success(1);',
      errors: suffix,
    },
    {
      filename: file,
      code: 'const createX = async (): Promise<OperationResult<X, E>> => success(1);\nexport { createX };',
      errors: suffix,
    },
    {
      filename: file,
      code: 'async function createX(): Promise<OperationResult<X, E>> { return success(1); }\nexport { createX };',
      errors: suffix,
    },
    // a stale allowlist entry fails
    {
      filename: file,
      code: 'export const createX_IO = async (): Promise<OperationResult<X, E>> => success(1);',
      options: [
        { allow: ['src/domain/gallery/operations/x.operations.ts::createX'] },
      ],
      errors: [{ messageId: 'stale' }],
    },
  ],
});
