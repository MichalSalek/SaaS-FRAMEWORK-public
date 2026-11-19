// @vitest-environment node
// Keys come from the REAL SSOT config (the rule reads it), so these samples use real keys.
import guard from './storage-adapter-only.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const options = [guard.blocks[0].options];
const file = 'src/UI/features/x/useThing.tsx';
const raw = [{ messageId: 'rawAccess' }];
const key = [{ messageId: 'keyLiteral' }];
const ok = code => ({ code, filename: file, options });
const bad = (code, errors) => ({ code, filename: file, options, errors });

tester.run('nf/storage-adapter-only', guard.rule, {
  valid: [
    // the adapter and the key constant
    ok(
      "import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';\nsetToClientStorage(STORAGE_KEYS.FIRST_TOUCH, v);"
    ),
    ok('const k = activationLatchKey(accountId);'),
    // typeof guards, other members
    ok("if (typeof localStorage === 'undefined') {}"),
    ok('const n = localStorage.length;'),
    // a local object that only shares the method name
    ok('const cache = new Map(); cache.clear(); store.getItem(k);'),
    // the allowlisted adapter dir, the config itself and the platform escape hatch
    {
      code: "localStorage.setItem('nf:first-touch', v);",
      filename:
        'src/application/client-device-storage/local-storage-adapter/adapter.ts',
      options,
    },
    {
      code: "export const STORAGE_KEYS = { FIRST_TOUCH: 'nf:first-touch' };",
      filename: 'src/application/client-device-storage/storage-keys.config.ts',
      options,
    },
    {
      code: 'sessionStorage.getItem(PLATFORM_STORAGE_KEY);',
      filename: 'src/application/platform/platform.detection.ts',
      options,
    },
    // prose: comments never count; code inside a string is not code
    ok(
      "// localStorage.getItem('nf:first-touch')\n/* sessionStorage.setItem('nf:pricing-funnel') */\nconst a = 1;"
    ),
    // prose in a string that names storage but calls nothing
    ok("const note = 'dismiss per session (sessionStorage)';"),
    // the allowlisted inline Consent Mode script
    {
      code: 'export const S = `try{var v=localStorage.getItem(${KEY})}catch(e){}`;',
      filename: 'src/application/analytics/consent-default-script.ts',
      options,
    },
    // generic keys 'theme' / 'mode' are skipped on purpose
    ok("type P = Omit<Props, 'mode' | 'theme'>;"),
    // a literal that merely contains a key text later on
    ok("const s = 'see nf:first-touch';"),
  ],
  invalid: [
    // invariant 1: raw Web Storage calls
    bad("localStorage.getItem('x');", raw),
    bad("sessionStorage.setItem('x', '1');", raw),
    bad("window.localStorage.removeItem('x');", raw),
    bad("globalThis.sessionStorage['getItem']('x');", raw),
    bad('localStorage.clear();', raw),
    // aliases the grep could not see
    bad("const s = window.localStorage;\ns.getItem('x');", raw),
    bad(
      "const s = sessionStorage as Storage;\nconst t = s;\nt.setItem('x', '1');",
      raw
    ),
    // invariant 1 inside an inline script string (runs as code) outside the allowlist
    bad('const script = `try{localStorage.getItem(${KEY})}catch(e){}`;', [
      { messageId: 'rawInString' },
    ]),
    bad('const script = \'sessionStorage.setItem("k",1)\';', [
      { messageId: 'rawInString' },
    ]),
    // invariant 2: an SSOT key re-hardcoded (strings are read on purpose)
    bad("const k = 'cookie-consent-v1';", key),
    bad('const k = "nf:first-touch";', key),
    bad('const k = `nf:pricing-funnel`;', key),
    bad("<Thing storageKey='nf:playground-votes' />", key),
    // a per-entity prefix concatenated inline, which the config bans
    bad('const k = `nf:activation:${accountId}`;', key),
    bad("const k = 'admin-support-notes:' + threadId;", key),
  ],
});
