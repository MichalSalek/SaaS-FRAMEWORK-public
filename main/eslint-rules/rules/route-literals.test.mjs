// @vitest-environment node
import guard from './route-literals.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const options = [guard.blocks[0].options];
const testOptions = [guard.blocks[1].options];
const file = 'src/UI/features/x/Thing.tsx';
const literal = [{ messageId: 'literal' }];
const replace = [{ messageId: 'replace' }];
const ok = code => ({ code, filename: file, options });
const bad = (code, errors) => ({ code, filename: file, options, errors });

tester.run('nf/route-literals', guard.rule, {
  valid: [
    // the registry and buildRoute
    ok('const h = ROUTES_FRONT.APP_HOME;'),
    ok('const h = buildRoute(ROUTES_FRONT.BLOG_CATEGORY, { category: c });'),
    // decorative mockup data, exempt like the grep exempted it
    ok("<PhoneFrame route='/app/gallery' />"),
    ok('<PhoneFrame route={`/app/photo/${id}`} />'),
    ok("const mock = { route: '/app/clients' };"),
    // prose
    ok("// router.push('/app/home')\n/* href='/user/login' */\nconst a = 1;"),
    // not an app path
    ok(
      "const a = '/application/x'; const b = '/app'; const c = 'see /app/home';"
    ),
    ok("const s = text.replace('a', 'b');"),
    // allowlisted places
    {
      code: "const x = '/user/login';",
      filename: 'src/application/policies/route-access.policy.ts',
      options,
    },
    {
      code: 'result = result.replace(`[${key}]`, encodeURIComponent(value));',
      filename: 'src/application/routing/buildRoute.ts',
      options,
    },
    // tests: literal paths allowed (invariant 1 still applies, see invalid)
    {
      code: "expect(href).toBe('/app/home');",
      filename: 'src/UI/x.test.tsx',
      options: testOptions,
    },
  ],
  invalid: [
    bad("router.push('/app/home');", literal),
    bad('const h = "/user/login";', literal),
    bad('const h = `/app/photo/${id}`;', literal),
    bad("<Link href='/app/clients'>x</Link>", literal),
    bad("<Link href={'/app/clients'}>x</Link>", literal),
    bad("type R = '/app/home';", literal),
    // static pages and the UI library are no longer exempt as a whole (only route= / route:)
    {
      code: "const x = '/app/home';",
      filename: 'src/UI/features/static/Lp.tsx',
      options,
      errors: literal,
    },
    {
      code: "const x = '/app/home';",
      filename: 'src/UI/features/ui-library/Demo.tsx',
      options,
      errors: literal,
    },
    // an interpolated prefix, which the grep could not see
    bad('const h = `${origin}/app/home`;', literal),
    // a property that is not `route`
    bad("const nav = { href: '/app/home' };", literal),
    // invariant 1: manual param fill, multi-line too (the grep read one line and missed two live sites)
    bad("const h = ROUTES_FRONT.X.replace('[id]', id);", replace),
    bad('const h = ROUTES_FRONT.X.replace(\n  "[id]",\n  id\n);', replace),
    bad('const h = ROUTES_FRONT.X.replaceAll(`[id]`, id);', replace),
    {
      code: "const h = R.replace('[id]', id);",
      filename: 'src/UI/x.test.tsx',
      options: testOptions,
      errors: replace,
    },
  ],
});
