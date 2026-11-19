// css/ch-measure — a text measure never uses the `ch` unit; it uses the tokens.
//
// Successor of tests/audit/ch-measure.sh. `ch` is the width of „0” in the face drawing the text
// NOW: while the fallback face draws, every `ch` box shrinks and the page jumps on font swap (the
// font-swap CLS of four hero pages). A measure is `calc(N * var(--ch-body))` at body weight or
// `calc(N * var(--ch-heading))` at heading weight. A face that is not Schibsted (a monospace
// column) may keep `ch` with `/* ch-allow: <reason> */` on the line or up to two lines above.
// Canon: DECISION next to --ch-body / --ch-heading in src/UI/styles/tokens.css.
import { hasAllowMarker } from '../engine.mjs';

const ANCHOR = 'src/UI/styles/tokens.css';
// A number directly followed by `ch` and a boundary, not part of an identifier, class or hex.
const RAW_CH = /(?<![\w.#-])\d*\.?\d+ch\b/;
const TOKEN = /var\(--ch-(body|heading)\)/;

const stripStrings = value => value.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');

export default {
  name: 'ch-measure',
  replaces: 'tests/audit/ch-measure.sh',
  files: ['src/**/*.css'],
  ignores: [],
  paths: [ANCHOR],
  presence: { minSites: 1, what: 'measures on var(--ch-body|heading)' },
  setup(ctx) {
    if (!ctx.exists(ANCHOR)) {
      return;
    }
    const tokens = ctx.read(ANCHOR);
    for (const token of ['--ch-body', '--ch-heading']) {
      if (!new RegExp(`${token}:\\s*[0-9.]+em`).test(tokens)) {
        ctx.error(`${ANCHOR} no longer defines ${token} as an em length`);
      }
    }
  },
  check(root, ctx) {
    const inspect = (node, text) => {
      const code = stripStrings(text);
      if (TOKEN.test(code)) {
        ctx.site();
      }
      if (RAW_CH.test(code) && !hasAllowMarker(node, 'ch-allow')) {
        ctx.report(node, 'raw ch length; use calc(N * var(--ch-body)) or var(--ch-heading)');
      }
    };
    root.walkDecls(decl => inspect(decl, decl.value));
    root.walkAtRules(atRule => inspect(atRule, atRule.params));
  },
};
