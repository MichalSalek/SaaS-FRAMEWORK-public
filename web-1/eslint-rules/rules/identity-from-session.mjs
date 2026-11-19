// nf/identity-from-session — identity fields (who acts, whose account) come from the session
// (`currentUser`, an account guard), never from the attacker-controlled request body.
//
// Successor of tests/audit/currentuser-enforcement.sh.
// The grep anchored on the literal text `body.<field>`, `{ <field> } = body` or `body['<field>']`,
// so `const b = req.body; const { account_id } = b`, a renamed handler parameter
// (`handle: async (input, ctx) => input.account_id`), `({ body: { account_id } })` and the
// `defineEndpoint` `input` passed. This rule follows the value (shared `_flow.mjs`): a read of an
// identity field (member access in any form, or a destructuring key at any depth) from the body
// or any part of it is reported, whatever the alias.
import { countSite, staticPropertyName } from '../lib.mjs';
import {
  createBodyFlow,
  paramRootState,
  propertyKey,
  stepState,
} from './_flow.mjs';

// Field names that identify a user or account. Matched as a PREFIX (as the grep's dotted form
// did), so `user_ids` and `client_id_list` count too.
const IDENTITY_FIELDS = [
  'userId',
  'user_id',
  'accountId',
  'account_id',
  'stylistId',
  'stylist_id',
  'clientId',
  'client_id',
  'createdBy',
  'created_by',
];

const isIdentityField = name =>
  IDENTITY_FIELDS.some(field => name.startsWith(field));

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Identity fields must come from the session (currentUser), never from the request body.',
    },
    schema: [],
    messages: {
      fromBody:
        'IDOR: identity field `{{field}}` is read from the request body. Take it from the session (currentUser / an account guard); an admin route acting on another user lives under pages/api/v1/admin.',
    },
  },
  create(context) {
    const flow = createBodyFlow(context.sourceCode);

    /**
     * Checks a destructuring pattern whose source state is known ('body' / 'derived' = the body
     * or a part of it, 'ctx' = the defineEndpoint context, 'none' = anything else; a key `body`
     * at any depth switches its sub-pattern to the body).
     */
    function checkPattern(pattern, state) {
      if (pattern?.type === 'AssignmentPattern') {
        checkPattern(pattern.left, state);
        return;
      }
      if (pattern?.type === 'ArrayPattern') {
        const inner =
          state === 'body' || state === 'derived' ? 'derived' : 'none';
        pattern.elements.forEach(element => checkPattern(element, inner));
        return;
      }
      if (pattern?.type !== 'ObjectPattern') {
        return;
      }
      const fromBody = state === 'body' || state === 'derived';
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          continue;
        }
        const key = propertyKey(property);
        countSite('identity-from-session');
        if (fromBody && key !== null && isIdentityField(key)) {
          context.report({
            node: property,
            messageId: 'fromBody',
            data: { field: key },
          });
          continue;
        }
        checkPattern(property.value, stepState(state, key));
      }
    }

    const stateOf = expression => {
      if (flow.isBody(expression)) {
        return 'body';
      }
      return flow.isBodyDerived(expression) ? 'derived' : 'none';
    };

    return {
      MemberExpression(node) {
        const name = staticPropertyName(node);
        if (name === null) {
          return;
        }
        countSite('identity-from-session');
        if (isIdentityField(name) && flow.isBodyDerived(node.object)) {
          context.report({
            node,
            messageId: 'fromBody',
            data: { field: name },
          });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' || !node.init) {
          return;
        }
        checkPattern(node.id, stateOf(node.init));
      },
      AssignmentExpression(node) {
        if (
          node.left.type !== 'ObjectPattern' &&
          node.left.type !== 'ArrayPattern'
        ) {
          return;
        }
        checkPattern(node.left, stateOf(node.right));
      },
      ':function'(fn) {
        fn.params.forEach(param => {
          const root = param.type === 'AssignmentPattern' ? param.left : param;
          if (root.type === 'ObjectPattern' || root.type === 'ArrayPattern') {
            checkPattern(root, paramRootState(fn, param));
          }
        });
      },
    };
  },
};

export default {
  name: 'identity-from-session',
  replaces: 'tests/audit/currentuser-enforcement.sh',
  rule,
  blocks: [
    {
      files: ['src/pages/api/v1/**/*.ts'],
      // Admin routes act on OTHER users by design: the target id is input there (the old
      // script's allowlist fragment `admin/`, which matched only this directory).
      ignores: [
        'src/pages/api/v1/admin/**',
        // Legacy admin target is accepted only after requireAdminPermission during client rollout.
        // Test: src/test-utils/integration/email-history-access.test.ts (real grants, mocked auth/DB).
        'src/pages/api/v1/email/get-history/index.ts',
      ],
    },
  ],
  presence: {
    minSites: 2500,
    what: 'member reads and destructuring keys in web-1/src/pages/api/v1',
  },
  paths: [
    'src/pages/api/v1',
    'src/pages/api/v1/admin',
    'src/pages/api/v1/email/get-history/index.ts',
  ],
};
