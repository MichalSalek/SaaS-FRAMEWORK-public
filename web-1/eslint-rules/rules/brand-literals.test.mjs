// @vitest-environment node
// Byte-identical in main/, web-1/ and the root.
import guard from './brand-literals.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const tsx = createRuleTester({ jsx: true });
const error = [{ messageId: 'literal' }];

tester.run('nf/brand-literals', guard.rule, {
  valid: [
    // the correct form
    "import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';\nconst url = BRAND_CONFIG.url;",
    'const u = `https://${BRAND_CONFIG.domain}/app`;',
    // the bare name is out of scope
    "const name = 'Nailfolio';",
    // prose: line comment, trailing comment, block comment, JSDoc
    '// see https://nailfolio.app\nconst a = 1;',
    'const a = 1; // nailfolio://login',
    '/* com.nailfolio.app */\nconst a = 1;',
    '/**\n * Handle @nailfolio_app on X.\n */\nconst a = 1;',
    // a look-alike that is not the brand
    "const host = 'nailfolio-app.betteruptime.com';",
  ],
  invalid: [
    { code: "const d = 'nailfolio.app';", errors: error },
    { code: "const u = 'https://nailfolio.app/app';", errors: error },
    { code: 'const s = "nailfolio://callback";', errors: error },
    { code: "const h = '@nailfolio_app';", errors: error },
    { code: "const p = 'com.nailfolio.app';", errors: error },
    // a template chunk, also across lines
    { code: 'const u = `https://nailfolio.app/${path}`;', errors: error },
    { code: 'const u = `\n * https://nailfolio.app\n`;', errors: error },
    // a literal in code that carries a trailing comment
    { code: "const d = 'nailfolio.app'; // fallback", errors: error },
    // object keys and fallbacks are values too
    { code: "const o = { domain: x || 'nailfolio.app' };", errors: error },
  ],
});

tsx.run('nf/brand-literals (tsx)', guard.rule, {
  valid: [
    { code: 'const C = () => <a href={BRAND_CONFIG.url}>{/* nailfolio.app */}x</a>;', filename: 'x.tsx' },
  ],
  invalid: [
    { code: 'const C = () => <a href="https://nailfolio.app">x</a>;', filename: 'x.tsx', errors: error },
    { code: 'const C = () => <p>Write to us at nailfolio.app</p>;', filename: 'x.tsx', errors: error },
  ],
});
