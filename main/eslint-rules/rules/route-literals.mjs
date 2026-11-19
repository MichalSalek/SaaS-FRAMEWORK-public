// nf/route-literals — app paths come from the route registries (ROUTES_FRONT / ROUTES_API in
// the kernel routing.config), and route parameters go through buildRoute().
//
// Successor of tests/audit/route-literals.sh. Two invariants:
//   1. no `.replace('[…', …)` / `.replaceAll('[…', …)` on a route template (any quote form,
//      template literal included): use buildRoute(ROUTE, { param });
//   2. no string literal or template piece that STARTS with `/app/` or `/user/` outside the
//      allowlist. Decorative mockup data is exempt where the old guard exempted it: the value of a
//      JSX attribute `route=` and of an object property `route:`.
// Comments are prose and never count; strings are read on purpose (a path IS a string).
import { countSite } from '../lib.mjs';
import { matchesAny, relativeFile, staticString } from './_guard-files.mjs';

const APP_PATH = /^\/(app|user)\//;

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No hardcoded /app/ or /user/ paths; route params through buildRoute().',
    },
    schema: [
      {
        type: 'object',
        properties: {
          literalAllow: { type: 'array', items: { type: 'string' } },
          literals: { type: 'boolean' },
          replaceAllow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      replace:
        "Route parameter filled with .{{method}}('[…'): use buildRoute(ROUTE_TEMPLATE, { param: value }).",
      literal:
        "Hardcoded app path '{{text}}': use ROUTES_FRONT.* / ROUTES_API.* from routing.config (buildRoute for params).",
    },
  },
  create(context) {
    const literalAllow = context.options[0]?.literalAllow ?? [];
    const checkReplace = !matchesAny(
      relativeFile(context),
      context.options[0]?.replaceAllow ?? []
    );
    const checkLiterals =
      context.options[0]?.literals !== false &&
      !matchesAny(relativeFile(context), literalAllow);

    function isDecorativeRoute(node) {
      const parent = node.parent;
      if (parent?.type === 'JSXAttribute') {
        return (
          parent.name.type === 'JSXIdentifier' && parent.name.name === 'route'
        );
      }
      if (
        parent?.type === 'JSXExpressionContainer' &&
        parent.parent?.type === 'JSXAttribute'
      ) {
        const attr = parent.parent;
        return attr.name.type === 'JSXIdentifier' && attr.name.name === 'route';
      }
      if (parent?.type === 'Property' && parent.value === node) {
        const key = parent.key;
        return (
          (key.type === 'Identifier' && key.name === 'route') ||
          (key.type === 'Literal' && key.value === 'route')
        );
      }
      return false;
    }

    function checkText(node, text) {
      countSite('route-literals');
      if (checkLiterals && APP_PATH.test(text) && !isDecorativeRoute(node)) {
        context.report({
          node,
          messageId: 'literal',
          data: { text: text.slice(0, 60) },
        });
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          checkReplace &&
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          (callee.property.name === 'replace' ||
            callee.property.name === 'replaceAll')
        ) {
          const first = node.arguments[0];
          const text =
            staticString(first) ??
            (first?.type === 'TemplateLiteral'
              ? (first.quasis[0].value.cooked ?? '')
              : null);
          if (text?.startsWith('[')) {
            context.report({
              node,
              messageId: 'replace',
              data: { method: callee.property.name },
            });
          }
        }
      },
      Literal(node) {
        if (typeof node.value === 'string') {
          checkText(node, node.value);
        }
      },
      TemplateLiteral(node) {
        // `/app/` at the start, or right after an interpolation (`${origin}/app/…`, which the
        // grep could not see because the quote does not precede the path).
        const hit = node.quasis.find(q => APP_PATH.test(q.value.cooked ?? ''));
        checkText(
          node,
          hit ? hit.value.cooked : (node.quasis[0].value.cooked ?? '')
        );
      },
    };
  },
};

export default {
  name: 'route-literals',
  replaces: 'tests/audit/route-literals.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.{ts,tsx}'],
      // Tests may assert literal paths: invariant 2 skips them, invariant 1 still covers them
      // (second block, as in the old guard).
      ignores: ['**/*.test.ts', '**/*.test.tsx'],
      options: {
        // buildRoute itself fills `[param]` with String#replace: it is the one sanctioned place.
        replaceAllow: ['src/application/routing/buildRoute.ts'],
        // The old guard also exempted UI/features/static/ and UI/features/ui-library/ whole; both
        // read zero findings without the exemption (their mockups use `route=` / `route:`, exempt
        // above), so the dead exemptions were dropped instead of inviting growth.
        literalAllow: [
          // DECISION in the file: an access-control classification table independent of nav config.
          'src/application/policies/route-access.policy.ts',
        ],
      },
    },
    {
      // Disjoint from the block above (no option override): tests keep invariant 1 only.
      files: ['src/**/*.test.{ts,tsx}'],
      options: { literals: false },
    },
  ],
  presence: {
    minSites: 30000,
    what: 'string literals and templates checked in main/src',
  },
  paths: [
    'src/application/routing/buildRoute.ts',
    'src/application/policies/route-access.policy.ts',
  ],
};
