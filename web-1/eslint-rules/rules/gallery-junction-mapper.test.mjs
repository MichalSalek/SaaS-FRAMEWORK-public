// @vitest-environment node
import guard from './gallery-junction-mapper.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const owner = 'src/domain/gallery/gallery.utils.api.ts';
const other = 'src/domain/user/operations/export.ts';
const error = [{ messageId: 'inline' }];

tester.run('nf/gallery-junction-mapper', guard.rule, {
  valid: [
    { code: `const hex = c.color.hex_code;`, filename: owner },
    { code: `const featured = t.trait.is_featured;`, filename: owner },
    {
      code: `const hex = c.color.hex_code; // gallery-mapper-allow: GDPR export keeps name and hex only`,
      filename: other,
    },
    { code: `// c.color.hex_code\nconst hex = row.hex_code;`, filename: other },
    { code: `const note = '.color.hex_code';`, filename: other },
    { code: `const hex = color.hex_code;`, filename: other },
  ],
  invalid: [
    { code: `const hex = c.color.hex_code;`, filename: other, errors: error },
    {
      code: `const featured = row.trait.is_featured;`,
      filename: other,
      errors: error,
    },
    {
      code: `const hex = c.color.hex_code; // gallery-mapper-allow:`,
      filename: other,
      errors: error,
    },
    { code: `const hex = c.color?.hex_code;`, filename: other, errors: error },
    {
      code: `const { hex_code } = row.color;`,
      filename: other,
      errors: error,
    },
    {
      code: `const { color: { hex_code } } = row;`,
      filename: other,
      errors: error,
    },
  ],
});
