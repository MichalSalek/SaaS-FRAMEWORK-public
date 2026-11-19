// css/spacing-tokens — spacing comes from the --space-* scale, never from the keyboard.
//
// Successor of tests/audit/spacing-tokens.sh (ratchet closed at zero). Two invariants:
//   1. A raw px in a spacing property of a CSS module: margin / padding (every side, -inline,
//      -block and their -start/-end), gap / row-gap / column-gap, inset (and -inline/-block
//      sides). `top`/`left` stay out (a position, not a spacing). Legal: 0 / 0px (reset), 1px and
//      -1px (hairline and its compensation), relative units, and any value computed through
//      var() / calc() / clamp() / min() / max() / env(). A deliberate off-scale value is an
//      optical correction and must be NAMED: `/* optical: <reason> */` in the block, in the
//      comment right above it, in the head of an enclosing block, or up to four lines above the
//      block's opening line. A bare `optical:` without a reason does not escape.
//   2. The removed ordinal scale `var(--sp-N)` anywhere in a stylesheet under src (an undefined
//      var in a shorthand drops the whole declaration). The TSX half of this check is
//      nf/legacy-spacing-scale in eslint-rules.
import { escapeScope, markerState } from './_scope.mjs';
import { blankStrings, markerNear } from './_css-values.mjs';

const SPACING_PROP =
  /^(margin|padding)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$|^(row-|column-)?gap$|^inset(-(inline|block)(-(start|end))?)?$/;
const COMPUTED = /\b(var|calc|clamp|min|max|env)\s*\(/;
const PX = /(?:^|[\s(,])(-?\d*\.?\d+)px/g;
const LEGACY = /var\(--sp-[0-9]\)/;

/** Escape state for a declaration: its block scope, plus four lines above the block. */
function opticalState(decl) {
  const block = decl.parent;
  const scoped = markerState(escapeScope(block), 'optical');
  if (scoped === 'reason') {
    return 'reason';
  }
  const near = block.type === 'root' ? null : markerNear(block, 'optical', 4);
  return near ?? scoped;
}

export default {
  name: 'spacing-tokens',
  replaces: 'tests/audit/spacing-tokens.sh',
  files: ['src/**/*.css'],
  ignores: [],
  paths: [],
  presence: { minSites: 2000, what: 'spacing declarations in CSS modules' },
  check(root, ctx) {
    const isModule = ctx.file.endsWith('.module.css');
    const legacy = (node, text) => {
      if (LEGACY.test(blankStrings(text))) {
        ctx.report(
          node,
          'removed scale var(--sp-N) (undefined var); use --space-<px>: sp-0=4 sp-1=8 sp-2=12 sp-3=20 sp-4=32 sp-5=48 sp-6=64 sp-7=80 sp-8=96 sp-9=128'
        );
      }
    };
    root.walkAtRules(atRule => legacy(atRule, atRule.params));
    root.walkDecls(decl => {
      legacy(decl, decl.value);
      if (!isModule || !SPACING_PROP.test(decl.prop.toLowerCase())) {
        return;
      }
      ctx.site();
      const value = blankStrings(decl.value).replace(/\s+/g, ' ').trim();
      if (COMPUTED.test(value)) {
        return;
      }
      const bad = [...value.matchAll(PX)]
        .map(m => parseFloat(m[1]))
        .filter(px => px !== 0 && Math.abs(px) !== 1);
      if (bad.length === 0) {
        return;
      }
      const state = opticalState(decl);
      if (state === 'reason') {
        return;
      }
      ctx.report(
        decl,
        state === 'bare'
          ? `"optical:" without a reason does not escape ${decl.prop}: ${value}`
          : `raw px spacing ${decl.prop}: ${value}; take a --space-* step (tokens.css) or name an optical correction /* optical: <reason> */`
      );
    });
  },
};
