// @vitest-environment node
// Exercise the real flat config: replacing the vulnerable plugin must retain compiler diagnostics.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd });
const filename = 'src/UI/components/AppDrawer/AppDrawer.organism.tsx';

async function hookErrors(code) {
  const config = await eslint.calculateConfigForFile(filename);
  const rules = Object.fromEntries(
    Object.entries(config.rules).filter(([name]) =>
      name.startsWith('react-hooks/')
    )
  );
  const messages = new Linter().verify(
    code,
    [
      {
        files: ['**/*.tsx'],
        languageOptions: {
          ...config.languageOptions,
          parserOptions: { project: false, ecmaFeatures: { jsx: true } },
        },
        plugins: { 'react-hooks': config.plugins['react-hooks'] },
        rules,
      },
    ],
    { filename }
  );
  expect(messages.some(message => message.fatal)).toBe(false);
  return messages;
}

describe('maintained React Compiler lint policy', () => {
  it('rejects conditional hooks', async () => {
    const messages = await hookErrors(`
      import {useState} from 'react';
      export function Component({enabled}) {
        if (enabled) { useState(0); }
        return null;
      }
    `);
    expect(
      messages.some(message => message.ruleId === 'react-hooks/rules-of-hooks')
    ).toBe(true);
  });

  it('rejects unconditional state writes during render', async () => {
    const messages = await hookErrors(`
      import {useState} from 'react';
      export function Component() {
        const [value, setValue] = useState(0);
        setValue(value + 1);
        return <div>{value}</div>;
      }
    `);
    expect(
      messages.some(
        message => message.ruleId === 'react-hooks/set-state-in-render'
      )
    ).toBe(true);
  });

  it('accepts a pure component', async () => {
    expect(
      await hookErrors(
        'export function Component({label}) { return <div>{label}</div>; }'
      )
    ).toEqual([]);
  });
});
