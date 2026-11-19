// css/no-sparkle — no decorative star paths or the star emoji in stylesheets.
//
// Successor of the CSS half of tests/audit/no-sparkle.sh. The path fragments are the
// 4-point tiles the shell lists (including the watermark family it missed on the first
// pass). Comments are not declarations, so a note about the ban does not trip the rule.
// SparkleIcon / StarIcon live in the ESLint half (nf/no-sparkle).
const PATHS = [
  'L72 18 L78 20',
  'L13.5 9',
  'L40 50 L41 53',
  'M40 12 L42 36 L62 40',
  'M50 18 L52 46 L78 50',
  'M40 8 L43 36 L72 40',
  'L72 40 L43 44 L40 72',
];

function hit(value) {
  if (value.includes('⭐')) {
    return 'star emoji';
  }
  return PATHS.find(fragment => value.includes(fragment))
    ? '4-point star path'
    : null;
}

export default {
  name: 'no-sparkle',
  replaces: 'tests/audit/no-sparkle.sh',
  files: ['src/**/*.css'],
  ignores: [],
  paths: ['src/UI/styles/tokens.css'],
  presence: {
    minSites: 15000,
    what: 'declarations inspected in stylesheets under main/src',
  },
  check(root, ctx) {
    root.walkDecls(decl => {
      ctx.site();
      const kind = hit(decl.value);
      if (kind) {
        ctx.report(decl, `${kind} in a stylesheet; decoration is not a star`);
      }
    });
  },
};
