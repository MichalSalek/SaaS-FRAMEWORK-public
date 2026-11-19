// @vitest-environment node
import guard from './no-body-cast.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const error = [{ messageId: 'cast' }];

tester.run('nf/no-body-cast', guard.rule, {
  valid: [
    // the seam: the body arrives as unknown
    'function h(req) { const rawBody: unknown = req.body; return rawBody; }',
    'function h(req) { return (req.body as unknown); }',
    // a cast of something else
    'function h(response) { return response.body as ReadableStream; }',
    'function h(req) { const payload = { a: 1 } as Payload; return payload; }',
    // prose and strings never count
    '// const x = req.body as Foo;\nconst a = 1;',
    "const s = 'req.body as Foo';",
    'const t = `req.body as ${Foo}`;',
    // a cast that asserts nothing: every field unknown, narrowed by the handler
    'function h(req) { const b = (req.body ?? {}) as { authCode?: unknown }; return b; }',
    'interface Raw { a?: unknown; b: unknown }\nfunction h(req) { return (req.body ?? {}) as Raw; }',
    'type Raw = { a?: unknown };\nfunction h(req) { return req.body as Raw; }',
    // destructuring another field
    'function h(req) { const { query } = req; return query as Q; }',
    // an alias of something unrelated
    'function h(req) { const b = req.query; return b as Q; }',
  ],
  invalid: [
    { code: 'function h(req) { return req.body as Foo; }', errors: error },
    { code: 'function h(request) { return request.body as Foo; }', errors: error },
    { code: "function h(req) { return req['body'] as Foo; }", errors: error },
    { code: 'function h(req) { return <Foo>req.body; }', errors: error },
    { code: 'function h(req) { return req.body as unknown as Foo; }', errors: error },
    { code: 'function h(req) { return (req.body ?? {}) as Foo; }', errors: error },
    { code: 'function h(req) { return (req.body || {}) as Foo; }', errors: error },
    { code: 'function h(req) { return req.body! as Foo; }', errors: error },
    // AU-4: the alias the grep could not see
    { code: 'function h(req) { const body = req.body; return body as Foo; }', errors: error },
    { code: 'function h(req) { const a = req.body; const b = a; return b as Foo; }', errors: error },
    { code: 'function h(req) { let b; b = req.body; return b as Foo; }', errors: error },
    { code: 'function h(req) { const { body } = req; return body as Foo; }', errors: error },
    { code: 'function h(req) { const { body: b } = req; return b as Foo; }', errors: error },
    { code: 'function h(req) { const r = req; return r.body as Foo; }', errors: error },
    // an object type that asserts a real field type
    { code: 'function h(req) { return req.body as { authCode?: string }; }', errors: error },
    { code: 'interface Raw { a?: string }\nfunction h(req) { return req.body as Raw; }', errors: error },
    { code: 'interface Raw extends Base { a?: unknown }\nfunction h(req) { return req.body as Raw; }', errors: error },
    // a request reached through a property (equivalence review)
    { code: 'function h(ctx) { return ctx.req.body as Foo; }', errors: error },
    { code: 'class C { h() { return this.request.body as Foo; } }', errors: error },
    // typed declaration re-asserting the any body
    { code: 'function h(req) { const b: Foo = req.body; return b; }', errors: error },
  ],
});
