// @vitest-environment node
import guard from './identity-from-session.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const error = [{ messageId: 'fromBody' }];
const handler = inner =>
  `export default defineHandler({ handle: async (body, ctx) => { ${inner} } });`;

tester.run('nf/identity-from-session', guard.rule, {
  valid: [
    // the correct form: identity from the session
    handler(
      'const { currentUser } = requireAuthenticatedContext(ctx); return op(currentUser.id, currentUser.account_id);'
    ),
    'function h(currentUser) { const { id, account_id } = currentUser; return [id, account_id]; }',
    // a target id that is not an identity field
    handler(
      'return op(body.target_user_id, body.client_user_id, body.visit_id);'
    ),
    handler(
      'const { gallery_record_id, target_account_id } = body; return [gallery_record_id, target_account_id];'
    ),
    // identity fields of something that is not the body
    'function h(req) { return req.query.user_id; }',
    handler('const result = await op(); return result.data.account_id;'),
    'export default defineEndpoint(C, { handle: async ({ input, ctx }) => ctx.user.account_id });',
    // prose and strings never count
    '// const { account_id } = req.body;\nconst a = 1;',
    "const s = 'body.account_id';",
    'const t = `${x} body.user_id`;',
    '/* body["userId"] */ const b = 2;',
  ],
  invalid: [
    // equivalence review: a parsed or copied body is still the body
    {
      code: 'function h(req, schema, op) { const raw = req.body; const body = schema.parse(raw); return op(body.account_id); }',
      errors: error,
    },
    {
      code: 'function h(req) { const parsed = JSON.parse(String(req.body)); return parsed.user_id; }',
      errors: error,
    },
    { code: 'function h(req) { const body = { ...req.body }; return body.user_id; }', errors: error },
    {
      code: 'function h(req, read) { const body = await read(req); return body.account_id; }',
      errors: error,
    },
    // the three shapes of the old grep
    { code: 'function h(req) { return req.body.userId; }', errors: error },
    { code: handler('return body.account_id;'), errors: error },
    { code: handler("return body['user_id'];"), errors: error },
    {
      code: 'function h(req) { const { account_id } = req.body; return account_id; }',
      errors: error,
    },
    {
      code: handler(
        'const { name, user_ids: ids = [] } = body; return [name, ids];'
      ),
      errors: error,
    },
    // AU-2: the alias the grep could not see
    {
      code: 'function h(req) { const b = req.body; const { account_id } = b; return account_id; }',
      errors: error,
    },
    {
      code: 'function h(req) { const b = req.body; return b.stylist_id; }',
      errors: error,
    },
    {
      code: 'function h(req) { let b; b = req.body; return b.clientId; }',
      errors: error,
    },
    // renames and wrapper shapes
    {
      code: 'export default defineHandler({ handle: async (payload, ctx) => payload.account_id });',
      errors: error,
    },
    {
      code: 'export default defineHandler({ handle: async ({ account_id }, ctx) => account_id });',
      errors: error,
    },
    {
      code: 'export default defineEndpoint(C, { handle: async ({ input }) => input.user_id });',
      errors: error,
    },
    {
      code: 'export default defineEndpoint(C, { handle: async ({ input: { created_by } }) => created_by });',
      errors: error,
    },
    {
      code: 'function h({ body: { userId } }) { return userId; }',
      errors: error,
    },
    {
      code: 'function h(ctx) { const { body: { accountId } } = ctx; return accountId; }',
      errors: error,
    },
    {
      code: 'function h(ctx) { const { body: payload } = ctx; return payload.createdBy; }',
      errors: error,
    },
    // a part of the body
    { code: handler('return body.props.account_id;'), errors: error },
    {
      code: handler('const { props } = body; return props.user_id;'),
      errors: error,
    },
    {
      code: handler('let x; ({ account_id: x } = body); return x;'),
      errors: error,
    },
  ],
});
