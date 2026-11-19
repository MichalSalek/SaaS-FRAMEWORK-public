// @vitest-environment node
import guard from './io-front-door.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const options = [guard.blocks[0].options];
const at = (filename, code, errors) =>
  errors ? { code, filename, options, errors } : { code, filename, options };
const UI = 'src/UI/features/x/useThing.tsx';
const DOMAIN = 'src/domain/x/thing.ts';
const APP = 'src/application/http/io.ts';
const factory = [{ messageId: 'factory' }];
const toPromise = [{ messageId: 'toPromise' }];
const uiImport = [{ messageId: 'uiImport' }];

tester.run('nf/io-front-door', guard.rule, {
  valid: [
    // the front door
    at(
      DOMAIN,
      "import { defineEndpoint } from '../../application/http/io';\nexport const changeName_IO = defineEndpoint(C.X);"
    ),
    at(UI, 'const m = useMutation({ mutationFn: changeName_IO });'),
    // toPromise lives in application/http (outside UI/domain roots)
    at(APP, 'export const f = toPromise(x_IO);'),
    at(
      'src/application/http/toPromise.adapter.ts',
      'export const toPromise = (f) => f;\nconst e = toPromise(y);'
    ),
    // the raw-callback allowlist
    at(
      'src/UI/features/admin/hooks/useBecomeUser.ts',
      'const becomeUser = toPromise(becomeUser_IO);'
    ),
    at(
      'src/UI/features/admin/hooks/useSwitchBackBecomeUser.ts',
      'const switchBack = toPromise(switchBackUser_IO);'
    ),
    // importing the name without calling it (the grep also required a call)
    at(
      UI,
      "import type { IOError } from '../../../application/http/toPromise.adapter';"
    ),
    // ENDPOINTS is fine outside UI
    at(
      DOMAIN,
      "import { ENDPOINTS } from '../../application/http/http.endpoints';"
    ),
    // prose: comments, strings, templates
    at(
      UI,
      '// was: toPromise(changeName_IO) / createIOFunction(...)\nconst a = 1;'
    ),
    at(UI, '/* import { ENDPOINTS } from x; createEndpointIO */\nconst a = 1;'),
    at(
      UI,
      "const s = 'toPromise(x) createQueryIOFunction import { ENDPOINTS }';"
    ),
    at(UI, 'const t = `createPathParamIOFunction ${toPromiseLabel}`;'),
    // a similar but different name
    at(UI, 'const p = toPromiseLike(x);'),
    at(
      UI,
      "import { AUTH_ENDPOINTS } from '../../../application/http/http.endpoints';"
    ),
  ],
  invalid: [
    // rule 1: deleted factories anywhere in src, any identifier position
    at(APP, 'export const x = createIOFunction(a);', factory),
    at(
      DOMAIN,
      "import { createEndpointIO } from '../../application/http/io';",
      [...factory, ...factory]
    ),
    at(
      'src/application/x.test.ts',
      'const f = createQueryIOFunction;',
      factory
    ),
    at(DOMAIN, 'export function createPathParamIOFunction() {}', factory),
    // rule 2: toPromise call in UI / domain
    at(UI, 'const run = toPromise(changeName_IO);', toPromise),
    at(DOMAIN, 'export const run = toPromise(changeName_IO);', toPromise),
    at(
      'src/UI/features/x/useThing.test.ts',
      'const run = toPromise(changeName_IO);',
      toPromise
    ),
    // aliases the grep could not see
    at(
      UI,
      "import { toPromise as wrap } from '../../../application/http/toPromise.adapter';\nconst run = wrap(changeName_IO);",
      toPromise
    ),
    at(
      UI,
      'const wrap = toPromise;\nconst run = wrap(changeName_IO);',
      toPromise
    ),
    at(
      UI,
      "import * as adapter from '../../../application/http/toPromise.adapter';\nconst run = adapter.toPromise(changeName_IO);",
      toPromise
    ),
    at(UI, 'const run = (toPromise as any)(changeName_IO);', toPromise),
    // rule 3: transport primitive imported into UI, single- and multi-line, re-export
    at(
      UI,
      "import { ENDPOINTS } from '../../../application/http/http.endpoints';",
      uiImport
    ),
    at(
      UI,
      "import {\n  AUTH_ENDPOINTS,\n  ENDPOINTS,\n} from '../../../application/http/http.endpoints';",
      uiImport
    ),
    at(
      UI,
      "import { ENDPOINTS as E } from '../../../application/http/http.endpoints';",
      uiImport
    ),
    at(
      UI,
      "export { ENDPOINTS } from '../../../application/http/http.endpoints';",
      uiImport
    ),
    at(UI, "import { createIOFunction } from '../../../application/http/io';", [
      ...uiImport,
      ...factory,
      ...factory,
    ]),
  ],
});
