// nf/body-spread-session-last — a request body spread into an object must be followed by the
// session-owned fields it could otherwise forge.
//
// Successor of tests/audit/security-idor.sh. The grep
// matched the text `...body` and then looked for a session field name within five lines below or
// above, so `...req.body`, `const b = req.body; { ...b }` and a renamed handler parameter
// passed, and a session field five lines further down in a DIFFERENT object counted as protection.
// This rule follows the value (shared `_flow.mjs`): a spread whose argument is the request body or
// any part of it must sit in an object literal where a session-owned key comes AFTER it, with a
// value that is not itself read from the body. A session key placed BEFORE the spread is
// overwritten by it (the attacker's value wins) and is reported as such.
import { countSite } from '../lib.mjs';
import { createBodyFlow, propertyKey } from './_flow.mjs';

// The keys that MUST come from currentUser / accountCheck / the session, never from the body
// (exact keys; the grep matched these as substrings, so `target_user_id` counted as protection).
const SESSION_FIELDS = new Set([
  'account_id',
  'created_by_account_id',
  'created_by_user_id',
  'user_id',
  'requesting_account_id',
  'issued_by_user_id',
  'current_user_id',
  'current_stylist_account_id',
  'stylist_account_id',
]);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A spread request body must be followed (not preceded) by the session-owned fields it could forge.',
    },
    schema: [],
    messages: {
      overridden:
        'IDOR: the request body is spread AFTER `{{field}}`, so a body field of that name overrides the session value. Put the session fields after the spread.',
      unprotected:
        'IDOR: the request body is spread with no session-owned field after it ({{fields}}). Set the owner from the session after the spread, or pick the fields explicitly.',
    },
  },
  create(context) {
    const flow = createBodyFlow(context.sourceCode);

    function sessionKeyOf(property) {
      const key = propertyKey(property);
      return key !== null && SESSION_FIELDS.has(key) ? key : null;
    }

    return {
      'ObjectExpression > SpreadElement'(spread) {
        countSite('body-spread-session-last');
        if (!flow.isBodyDerived(spread.argument)) {
          return;
        }
        const properties = spread.parent.properties;
        const index = properties.indexOf(spread);
        const after = properties
          .slice(index + 1)
          .some(
            property =>
              sessionKeyOf(property) !== null &&
              !flow.isBodyDerived(property.value)
          );
        if (after) {
          return;
        }
        const before = properties
          .slice(0, index)
          .map(sessionKeyOf)
          .find(Boolean);
        if (before) {
          context.report({
            node: spread,
            messageId: 'overridden',
            data: { field: before },
          });
          return;
        }
        context.report({
          node: spread,
          messageId: 'unprotected',
          data: { fields: [...SESSION_FIELDS].join(', ') },
        });
      },
    };
  },
};

export default {
  name: 'body-spread-session-last',
  replaces: 'tests/audit/security-idor.sh',
  rule,
  blocks: [
    {
      // Root: every API route (the old script's root, pages/api). No allowlist: the old one was
      // empty, and a public route that spreads the body has no owner to protect, so it should
      // pick fields explicitly instead.
      files: ['src/pages/api/**/*.ts'],
    },
  ],
  presence: { minSites: 60, what: 'object spreads in web-1/src/pages/api' },
  paths: ['src/pages/api'],
};
