// nf/naming-case — web-1 backend files in application/ and domain/ are kebab-case.
//
// Successor of tests/audit/naming-case.sh. The script flagged a `.ts` basename
// with an uppercase letter. This rule checks the path below src/application or src/domain against
// the actual convention instead of one symptom of breaking it:
//   - file name: lowercase letters and digits in parts joined by `-` or `.`
//     (`gallery-pin.operations.ts`, `lock-rows.test.ts`); catches camelCase, snake_case, spaces;
//   - every directory below the root: kebab-case, optionally with a leading `_` (`_shared`).
// `.tsx` (React, PascalCase by convention) and `.d.ts` stay out, as before; the generated clients
// and the vendored kernel are global ignores of the workspace config. One site = one file.
import { countSite } from '../lib.mjs';
import { slashed } from './_scope.mjs';

const NAME = 'naming-case';
const FILE = /^[a-z0-9]+([.-][a-z0-9]+)*\.ts$/;
const DIRECTORY = /^_?[a-z0-9]+(-[a-z0-9]+)*$/;
const ROOT = /(?:^|\/)src\/(application|domain)\/(.+)$/;

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'kebab-case file and directory names in web-1 src/application and src/domain.',
    },
    schema: [],
    messages: {
      file: "File name '{{name}}' is not kebab-case (lowercase parts joined by '-' or '.').",
      directory: "Directory '{{name}}' is not kebab-case.",
    },
  },
  create(context) {
    const filename = slashed(context.filename);
    const match = ROOT.exec(filename);
    if (!match || !filename.endsWith('.ts') || filename.endsWith('.d.ts')) {
      return {};
    }
    return {
      Program(node) {
        countSite(NAME);
        const parts = match[2].split('/');
        const base = parts.pop();
        for (const directory of parts) {
          if (!DIRECTORY.test(directory)) {
            context.report({
              node,
              loc: { line: 1, column: 0 },
              messageId: 'directory',
              data: { name: directory },
            });
          }
        }
        if (!FILE.test(base)) {
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: 'file',
            data: { name: base },
          });
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/naming-case.sh',
  rule,
  blocks: [
    {
      files: ['src/application/**/*.ts', 'src/domain/**/*.ts'],
      ignores: ['**/*.d.ts'],
    },
  ],
  presence: {
    minSites: 700,
    what: '.ts files in web-1 src/application and src/domain',
  },
  paths: ['src/application', 'src/domain'],
};
