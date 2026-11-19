// @vitest-environment node
import guard from './body-spread-session-last.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const unprotected = [{ messageId: 'unprotected' }];
const overridden = [{ messageId: 'overridden' }];

const handler = inner =>
  `export default defineHandler({ handle: async (body, ctx) => { ${inner} } });`;

tester.run('nf/body-spread-session-last', guard.rule, {
  valid: [
    // the safe form: session fields AFTER the spread (the two real sites)
    handler(
      'return op({ props: { ...body, created_by_account_id: check.data.account_id } });'
    ),
    'function h(req, user) { return { ...req.body, user_id: user.id }; }',
    'function h(req, user) { const b = req.body; return { ...b, account_id: user.account_id }; }',
    // a spread of something that is not the body
    'function h(user) { return { ...user, account_id: user.account_id }; }',
    'function h(req) { return { ...req.query }; }',
    // a conditional spread of a literal object picked field by field
    handler(
      'return { ...(body.limit !== undefined && { limit: body.limit }) };'
    ),
    // prose and strings never count
    '// { account_id: x, ...body }\nconst a = 1;',
    "const s = '{ account_id: x, ...body }';",
    'const t = `{ ...body }`;',
    // an explicit field pick (allowlisted keys) is not the body
    "function h(body) { return { ...redactAuditPayload(body, ['nail_length']), n: 1 }; }",
  ],
  invalid: [
    // equivalence review: a copy or a parse of the body spreads the same fields
    {
      code: "function h(req, omit) { const bodyRest = omit(req.body, 'id'); return { ...bodyRest }; }",
      errors: unprotected,
    },
    {
      code: 'function h(req, schema) { const parsed = schema.parse(req.body); return { ...parsed }; }',
      errors: unprotected,
    },
    {
      // the copy itself is an unprotected spread, and spreading the copy overrides user_id
      code: 'function h(req, u) { const copy = { ...req.body }; return { user_id: u.id, ...copy }; }',
      errors: [...unprotected, ...overridden],
    },
    // fixture-equivalent violations of the old script
    { code: 'function h(body) { return { ...body }; }', errors: unprotected },
    {
      code: 'function h(body, u) { return { account_id: u.id, ...body }; }',
      errors: overridden,
    },
    // AU-1: the spread of req.body the `...body` grep did not see
    {
      code: 'function h(req, u) { return { user_id: u.id, ...req.body }; }',
      errors: overridden,
    },
    {
      code: 'function h(req) { return { ...req.body }; }',
      errors: unprotected,
    },
    // aliases and renames
    {
      code: 'function h(req) { const b = req.body; return { ...b }; }',
      errors: unprotected,
    },
    {
      code: 'function h(req, u) { let b; b = req.body; return { account_id: u.id, ...b }; }',
      errors: overridden,
    },
    {
      code: 'function h(ctx) { const { body: input } = ctx; return { ...input }; }',
      errors: unprotected,
    },
    {
      code: 'export default defineHandler({ handle: async (payload, ctx) => ({ ...payload }) });',
      errors: unprotected,
    },
    {
      code: 'export default defineEndpoint(C, { handle: async ({ input }) => ({ ...input }) });',
      errors: unprotected,
    },
    {
      code: 'function h(req) { return { ...(req.body ?? {}) }; }',
      errors: unprotected,
    },
    // a part of the body is the body too
    { code: handler('return { ...body.props };'), errors: unprotected },
    {
      code: handler('const { props } = body; return { ...props };'),
      errors: unprotected,
    },
    // "protection" that is not protection: a non-session key, a session key read from the body,
    // a session key in ANOTHER object nearby
    {
      code: handler('return { ...body, target_user_id: ctx.user.id };'),
      errors: unprotected,
    },
    {
      code: handler('return { ...body, account_id: body.account_id };'),
      errors: unprotected,
    },
    {
      code: handler(
        'const a = { ...body };\nconst b = { account_id: ctx.id };\nreturn [a, b];'
      ),
      errors: unprotected,
    },
  ],
});
