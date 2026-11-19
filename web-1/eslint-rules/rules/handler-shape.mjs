// nf/handler-shape — every API route converges on the canonical handler pipeline (a route outside
// it skips the method gate, auth, RBAC, validation and the event envelope at once). By file
// position under src/:
//   (e) every route module in pages/api/v1 (tests excluded) default-exports a call of a sanctioned
//       wrapper IMPORTED from its module: defineHandler, defineEndpoint, defineEndpointSwitch,
//       withPublicHandler, withRawSecretHandler, or an allowlisted factory returning one. The direct middleware form
//       `withTimingNextHandlerMiddleware(handler)` is accepted only in the middleware allowlist.
//       A missing default export, a local function or a wrapper defined in the file fails.
//   (a) no raw `res.status(` in pages/api/v1 outside the raw-handler allowlist; an alias of `res`
//       counts as `res`.
//   (b) no `HTTPRequestHandlerMiddleware` reference in pages/api/v1 outside the allowlist.
//   (c) no local `parseQueryParams` definition in pages/** (use the shared @app/http helper).
//   (d) no default export in src/** outside pages/** (excluded framework shapes: .tsx, .d.ts,
//       *.config.*, instrumentation.ts, middleware.ts); `export { x as default }` counts.
// Prose never counts.
import { countSite } from '../lib.mjs';
import { variableOf } from './_flow.mjs';

const WRAPPERS = new Map([
  ['defineHandler', '@app/http/define-handler'],
  ['defineEndpoint', '@app/http/define-endpoint'],
  ['defineEndpointSwitch', '@app/http/define-endpoint'],
  ['withPublicHandler', '@app/http/define-raw-handler'],
  ['withRawSecretHandler', '@app/http/define-raw-handler'],
]);
const MIDDLEWARE_WRAPPER = [
  'withTimingNextHandlerMiddleware',
  '@app/http/timing.middleware',
];

const under = (filename, prefix) =>
  filename.includes(`/${prefix}`) || filename.startsWith(prefix);
const inAny = (filename, prefixes) =>
  prefixes.some(prefix => under(filename, prefix));

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'API routes go through the canonical handler pipeline.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          resStatusAllow: { type: 'array', items: { type: 'string' } },
          middlewareAllow: { type: 'array', items: { type: 'string' } },
          // factory name → module it must be imported from (each returns a sanctioned wrapper)
          wrapperFactories: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['resStatusAllow', 'middlewareAllow', 'wrapperFactories'],
        additionalProperties: false,
      },
    ],
    messages: {
      route:
        'Route outside the handler pipeline: the default export must be a call of defineHandler / defineEndpoint / defineEndpointSwitch / withPublicHandler / withRawSecretHandler imported from @app/http ({{found}}).',
      resStatus:
        '(a) raw `res.status(` in a v1 route: use defineHandler + respond*() helpers, or add the route to resStatusAllow if it is a deliberate raw handler.',
      middleware:
        '(b) direct HTTPRequestHandlerMiddleware in a v1 route: route through defineHandler, or add it to middlewareAllow if it is a deliberate auth-skip handler.',
      parseQueryParams:
        "(c) local parseQueryParams definition: import { parseQueryParams } from '@app/http/parse-query-params' and pass a declarative schema.",
      exportDefault:
        '(d) default export in an internal module: use a named export (export const / export { x }).',
    },
  },
  create(context) {
    const options = context.options[0];
    const sourceCode = context.sourceCode;
    const filename = context.filename.replaceAll('\\', '/');
    const base = filename.split('/').pop() ?? '';
    const isTest = /\.test\.tsx?$/.test(base);
    const inPages = under(filename, 'src/pages/');
    const inV1 = under(filename, 'src/pages/api/v1/');
    const isRoute = inV1 && !isTest && base.endsWith('.ts');
    const resStatusAllowed = inAny(filename, options.resStatusAllow);
    const middlewareAllowed = inAny(filename, options.middlewareAllow);
    const defaultExportScope =
      !inPages &&
      base.endsWith('.ts') &&
      !base.endsWith('.d.ts') &&
      !/\.config\./.test(base) &&
      base !== 'instrumentation.ts' &&
      base !== 'middleware.ts';

    /** Module an identifier is imported from, or null (local, global). */
    function importSource(identifier) {
      const variable = variableOf(sourceCode, identifier);
      const def = variable?.defs.find(d => d.type === 'ImportBinding');
      if (!def || def.node.type !== 'ImportSpecifier') {
        return null;
      }
      const imported = def.node.imported;
      const importedName =
        imported.type === 'Identifier' ? imported.name : imported.value;
      return importedName === identifier.name ? def.parent.source.value : null;
    }

    function sanctioned(expression, seen = new Set()) {
      let value = expression;
      while (
        value &&
        (value.type === 'TSAsExpression' ||
          value.type === 'TSSatisfiesExpression')
      ) {
        value = value.expression;
      }
      if (value?.type === 'Identifier') {
        const variable = variableOf(sourceCode, value);
        if (!variable || seen.has(variable)) {
          return `\`${value.name}\` is not a wrapper call`;
        }
        seen.add(variable);
        const def = variable.defs.find(d => d.type === 'Variable');
        if (
          def &&
          def.node.id.type === 'Identifier' &&
          def.node.init &&
          def.parent.kind === 'const'
        ) {
          return sanctioned(def.node.init, seen);
        }
        return `\`${value.name}\` is not a wrapper call`;
      }
      if (
        value?.type !== 'CallExpression' ||
        value.callee.type !== 'Identifier'
      ) {
        return `a ${value?.type ?? 'missing value'}`;
      }
      const name = value.callee.name;
      const source = importSource(value.callee);
      if (WRAPPERS.has(name)) {
        return source === WRAPPERS.get(name)
          ? null
          : `\`${name}\` not imported from ${WRAPPERS.get(name)}`;
      }
      if (Object.hasOwn(options.wrapperFactories, name)) {
        return source === options.wrapperFactories[name]
          ? null
          : `\`${name}\` not imported from ${options.wrapperFactories[name]}`;
      }
      if (name === MIDDLEWARE_WRAPPER[0] && middlewareAllowed) {
        return source === MIDDLEWARE_WRAPPER[1]
          ? null
          : `\`${name}\` not imported from ${MIDDLEWARE_WRAPPER[1]}`;
      }
      return `\`${name}(…)\``;
    }

    /** `res`, or a const alias of it. */
    function isRes(node, seen = new Set()) {
      if (node?.type !== 'Identifier') {
        return false;
      }
      if (node.name === 'res') {
        return true;
      }
      const variable = variableOf(sourceCode, node);
      if (!variable || seen.has(variable)) {
        return false;
      }
      seen.add(variable);
      return variable.defs.some(
        def =>
          def.type === 'Variable' &&
          def.node.id.type === 'Identifier' &&
          isRes(def.node.init, seen)
      );
    }

    const handlers = {};
    if (isRoute) {
      let defaultExport = null;
      handlers.ExportDefaultDeclaration = node => {
        defaultExport = node;
      };
      handlers['Program:exit'] = program => {
        countSite('handler-shape');
        if (!defaultExport) {
          context.report({
            node: program,
            messageId: 'route',
            data: { found: 'no default export' },
          });
          return;
        }
        const found = sanctioned(defaultExport.declaration);
        if (found !== null) {
          context.report({
            node: defaultExport,
            messageId: 'route',
            data: { found },
          });
        }
      };
    }
    if (inV1) {
      handlers.CallExpression = node => {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.name !== 'status'
        ) {
          return;
        }
        countSite('handler-shape');
        if (!resStatusAllowed && isRes(callee.object)) {
          context.report({ node, messageId: 'resStatus' });
        }
      };
      handlers.Identifier = node => {
        if (node.name !== 'HTTPRequestHandlerMiddleware') {
          return;
        }
        const parent = node.parent;
        if (
          parent.type === 'ImportSpecifier' &&
          parent.imported === node &&
          parent.local !== node
        ) {
          return; // `import { X }` carries two Identifier nodes for one name
        }
        countSite('handler-shape');
        if (!middlewareAllowed) {
          context.report({ node, messageId: 'middleware' });
        }
      };
    }
    if (inPages) {
      const report = id => {
        if (id?.type === 'Identifier' && id.name === 'parseQueryParams') {
          context.report({ node: id, messageId: 'parseQueryParams' });
        }
      };
      handlers.FunctionDeclaration = node => report(node.id);
      handlers.VariableDeclarator = node => report(node.id);
    }
    if (defaultExportScope) {
      handlers.Program = () => countSite('handler-shape');
      handlers.ExportDefaultDeclaration = node =>
        context.report({ node, messageId: 'exportDefault' });
      handlers.ExportSpecifier = node => {
        const exported =
          node.exported.type === 'Identifier'
            ? node.exported.name
            : node.exported.value;
        if (exported === 'default') {
          context.report({ node, messageId: 'exportDefault' });
        }
      };
    }
    return handlers;
  },
};

export default {
  name: 'handler-shape',
  replaces: 'tests/audit/handler-shape.sh',
  rule,
  blocks: [
    {
      // One block over the whole src root (several blocks for one rule would REPLACE each
      // other's options on overlapping files); each check selects its files by position.
      files: ['src/**/*.{ts,tsx}'],
      options: {
        // Raw handlers that emit HTTP status codes themselves (internal probes, token-public
        // links, multi-method routes). The old list also named webhooks/stripe/ and salon/staff/,
        // which call no `res.status(` (an exemption that exempts nothing invites growth): dropped.
        resStatusAllow: [
          'src/pages/api/v1/internal/track-crawler/',
          'src/pages/api/v1/internal/health-public/',
          'src/pages/api/v1/internal/sweep-tick/',
          'src/pages/api/v1/email/unsubscribe/',
          'src/pages/api/v1/public/newsletter-unsubscribe/',
          'src/pages/api/v1/public/newsletter-confirm/',
        ],
        // Token-public and multi-method routes that call the middleware directly (custom
        // auth-skip), each default-exporting withTimingNextHandlerMiddleware(handler).
        middlewareAllow: [
          'src/pages/api/v1/email/unsubscribe/',
          'src/pages/api/v1/public/newsletter-unsubscribe/',
          'src/pages/api/v1/public/newsletter-confirm/',
          'src/pages/api/v1/salon/staff/',
        ],
        // The delivery-webhook factory returns withPublicHandler({...}) for one provider (resend,
        // mailgun): one implementation, two routes.
        wrapperFactories: {
          lifecycleWebhookHandler:
            '@app/email-handler/lifecycle/delivery-webhook-handler',
        },
      },
    },
  ],
  presence: {
    minSites: 900,
    what: 'v1 routes, status calls, middleware references and internal modules in web-1/src',
  },
  paths: [
    'src/pages/api/v1',
    'src/pages/api/v1/internal/track-crawler',
    'src/pages/api/v1/internal/health-public',
    'src/pages/api/v1/internal/sweep-tick',
    'src/pages/api/v1/email/unsubscribe',
    'src/pages/api/v1/public/newsletter-unsubscribe',
    'src/pages/api/v1/public/newsletter-confirm',
    'src/pages/api/v1/salon/staff',
    'src/application/email-handler/lifecycle/delivery-webhook-handler.ts',
    'src/application/http/define-handler.ts',
    'src/application/http/define-endpoint.ts',
    'src/application/http/define-raw-handler.ts',
    'src/application/http/timing.middleware.ts',
  ],
};
