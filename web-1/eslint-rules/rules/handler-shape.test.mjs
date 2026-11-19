// @vitest-environment node
import guard from './handler-shape.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const options = [guard.blocks[0].options];
const ROUTE = 'src/pages/api/v1/gallery/sample/index.ts';
const at = (code, filename = ROUTE) => ({ code, filename, options });
const err = messageId => [{ messageId }];

const DEFINE = "import { defineHandler } from '@app/http/define-handler';\n";
const ROUTE_OK = `${DEFINE}export default defineHandler({ method: 'post', handle: async (body, ctx, meta, res) => respondSuccess(res, {}) });`;
const MIDDLEWARE_ROUTE = [
  "import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';",
  "import { HTTPRequestHandlerMiddleware } from '@app/http/request.middleware';",
  'const handler = async (req, res) => { await HTTPRequestHandlerMiddleware(req, res, {}); res.status(302).end(); };',
  'export default withTimingNextHandlerMiddleware(handler);',
].join('\n');

tester.run('nf/handler-shape', guard.rule, {
  valid: [
    // (e) every sanctioned wrapper
    at(ROUTE_OK),
    at(`${DEFINE}const handler = defineHandler({});\nexport default handler;`),
    at(
      "import { defineEndpoint } from '@app/http/define-endpoint';\nexport default defineEndpoint(C, { handle: async () => {} });"
    ),
    at(
      "import { defineEndpointSwitch } from '@app/http/define-endpoint';\nexport default defineEndpointSwitch([binding]);",
      'src/pages/api/v1/salon/staff/index.ts'
    ),
    at(
      "import { withPublicHandler } from '@app/http/define-raw-handler';\nexport default withPublicHandler({ handle: async (req, res) => {} });"
    ),
    at(
      "import { withRawSecretHandler } from '@app/http/define-raw-handler';\nexport default withRawSecretHandler({});"
    ),
    at(
      "import { lifecycleWebhookHandler } from '@app/email-handler/lifecycle/delivery-webhook-handler';\nexport default lifecycleWebhookHandler('resend');",
      'src/pages/api/v1/webhooks/resend/index.ts'
    ),
    // (a)+(b)+(e) the middleware allowlist: direct middleware and raw status
    at(MIDDLEWARE_ROUTE, 'src/pages/api/v1/email/unsubscribe/index.ts'),
    // (a) raw status in the raw-handler allowlist
    at(
      "import { withPublicHandler } from '@app/http/define-raw-handler';\nexport default withPublicHandler({ handle: async (req, res) => { res.status(200).json({}); } });",
      'src/pages/api/v1/internal/health-public/index.ts'
    ),
    // tests next to a route are not routes (no default export needed)
    at(
      "it('x', () => { expect(1).toBe(1); });",
      'src/pages/api/v1/gallery/sample/index.test.ts'
    ),
    // (c) the shared helper imported, not defined
    at(
      `import { parseQueryParams } from '@app/http/parse-query-params';\n${ROUTE_OK.replace(DEFINE, DEFINE + 'const q = parseQueryParams(req, S);\n')}`
    ),
    // (d) named exports in an internal module; framework shapes may default-export
    at(
      'export const adapter = {};',
      'src/application/cloudinary/cloudinary.adapter.ts'
    ),
    at('export default {};', 'src/application/cors/cors.config.ts'),
    at('export default function register() {}', 'src/instrumentation.ts'),
    at('export default function mw() {}', 'src/middleware.ts'),
    at('declare const x: number;\nexport default x;', 'src/types/env.d.ts'),
    at('export default function Page() { return null; }', 'src/pages/404.tsx'),
    // prose and strings never count
    at(
      `${ROUTE_OK}\n// res.status(500) and HTTPRequestHandlerMiddleware in a comment\nconst s = 'res.status(1) HTTPRequestHandlerMiddleware export default';`
    ),
    // a status call on something else
    at(`${ROUTE_OK}\nconst code = response.status(200);`),
  ],
  invalid: [
    // (e) the protected invariant: a route outside the pipeline
    {
      ...at(
        'export default async function handler(req, res) { res.json({}); }'
      ),
      errors: err('route'),
    },
    { ...at('export const handler = 1;'), errors: err('route') },
    {
      ...at('const defineHandler = c => c;\nexport default defineHandler({});'),
      errors: err('route'),
    },
    {
      ...at(
        "import { defineHandler } from './fake';\nexport default defineHandler({});"
      ),
      errors: err('route'),
    },
    {
      ...at(
        "import { defineHandler as dh } from '@app/http/define-handler';\nexport default dh({});"
      ),
      errors: err('route'),
    },
    {
      ...at(
        "import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';\nexport default withTimingNextHandlerMiddleware(async (req, res) => {});"
      ),
      errors: err('route'),
    },
    {
      ...at(
        "import { lifecycleWebhookHandler } from './somewhere-else';\nexport default lifecycleWebhookHandler('resend');"
      ),
      errors: err('route'),
    },
    // (a) raw res.status in a v1 route, also through an alias
    {
      ...at(`${ROUTE_OK}\nfunction f(res) { res.status(400).json({}); }`),
      errors: err('resStatus'),
    },
    {
      ...at(
        `${ROUTE_OK}\nfunction f(res) { const r = res; r.status(400).json({}); }`
      ),
      errors: err('resStatus'),
    },
    // (b) direct middleware outside the allowlist (import and call)
    {
      ...at(MIDDLEWARE_ROUTE, 'src/pages/api/v1/gallery/raw/index.ts'),
      errors: [
        { messageId: 'middleware' },
        { messageId: 'middleware' },
        { messageId: 'resStatus' },
        { messageId: 'route' },
      ],
    },
    // (a) applies to tests in v1 too, as the old script read every .ts there
    {
      ...at(
        "it('x', () => { res.status(200); });",
        'src/pages/api/v1/gallery/sample/index.test.ts'
      ),
      errors: err('resStatus'),
    },
    // (c) local parseQueryParams in pages (both forms)
    {
      ...at(`${ROUTE_OK}\nconst parseQueryParams = q => q;`),
      errors: err('parseQueryParams'),
    },
    {
      ...at(
        'function parseQueryParams(q) { return q; }\nexport default function P() { return null; }',
        'src/pages/index.tsx'
      ),
      errors: err('parseQueryParams'),
    },
    // (d) default export in an internal module, both forms
    {
      ...at(
        'export default { upload() {} };',
        'src/application/cloudinary/cloudinary.adapter.ts'
      ),
      errors: err('exportDefault'),
    },
    {
      ...at('const a = 1;\nexport { a as default };', 'src/domain/x/y.ts'),
      errors: err('exportDefault'),
    },
  ],
});
