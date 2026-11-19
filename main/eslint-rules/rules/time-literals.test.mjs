// @vitest-environment node
// Byte-identical in main/ and web-1/.
import guard from './time-literals.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const tsx = createRuleTester({ jsx: true });
const error = [{ messageId: 'literal' }];

tester.run('nf/time-literals', guard.rule, {
  valid: [
    // the correct form
    "import { TIME } from '@kernel/application/constants.config';\nconst TTL = 7 * TIME.MS_PER_DAY;",
    'const WINDOW = WINDOW_HOURS * TIME.MS_PER_HOUR;',
    // other arithmetic: minutes, seconds, sizes, bare ms values (deliberately out of scope)
    'const STALE_MS = 5 * 60 * 1000;',
    'const MAX_BYTES = 10 * 1024 * 1024;',
    'const SECONDS_PER_HOUR = 60 * 60;',
    'const DAY = 86400000;',
    'const x = 60 + 60 + 1000;',
    // prose: a line comment, a block comment, a string and a template literal
    '// const TTL = 24 * 60 * 60 * 1000;\nconst a = 1;',
    '/* 1000 * 60 * 60 */\nconst a = 1;',
    "const s = '24 * 60 * 60 * 1000';",
    'const t = `${n} x 60 * 60 * 1000`;',
  ],
  invalid: [
    // the four forms of the shell guard
    { code: 'const TTL = 24 * 60 * 60 * 1000;', errors: error },
    { code: 'const H = 60 * 60 * 1000;', errors: error },
    { code: 'const D = 1000 * 60 * 60 * 24;', errors: error },
    { code: 'const H = 1000 * 60 * 60;', errors: error },
    // whitespace, numeric separators, order, grouping, casts and line breaks the grep missed
    { code: 'const D = 24*60*60*1000;', errors: error },
    { code: 'const H = 60 * 60 * 1_000;', errors: error },
    { code: 'const H = 60 * 1000 * 60;', errors: error },
    { code: 'const W = 7 * 24 * 60 * 60 * 1000;', errors: error },
    { code: 'const D = (24 * 60) * (60 * 1000);', errors: error },
    { code: 'const D = 24 * (60 * 60 * 1000 as number);', errors: error },
    { code: 'const D =\n  24 *\n  60 *\n  60 *\n  1000;', errors: error },
    { code: 'const ttl = days * 24 * 60 * 60 * 1000;', errors: error },
    // one report per chain, not per sub-product
    { code: 'f(2 * 60 * 60 * 1000, 60 * 60 * 1000);', errors: [...error, ...error] },
  ],
});

tsx.run('nf/time-literals (tsx)', guard.rule, {
  valid: [{ code: 'const C = () => <p>{"60 * 60 * 1000"}</p>;', filename: 'x.tsx' }],
  invalid: [{ code: 'const C = () => <Timer ms={60 * 60 * 1000} />;', filename: 'x.tsx', errors: error }],
});
