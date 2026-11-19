// css/motion-tokens — transition times come from the scale, and no transition is dead.
//
// Successor of tests/audit/motion-tokens.sh. Read per transition PART (top-level comma split, a
// cubic-bezier keeps its commas), over every stylesheet under src except the scale itself:
//   1. DEAD (zero tolerance): a part that uses the composite var(--transition-fast|normal|slow)
//      (which already carries a curve, `200ms ease`) together with its own timing function
//      (cubic-bezier(), steps(), var(--ease-*) / var(--spring-*), linear, ease-in, ease-out,
//      ease-in-out). It expands to TWO timing functions, so CSS drops the whole declaration and
//      the transition silently does not run. Own curve → bare var(--duration-N).
//   2. RAW TIME (ratchet): a part with a literal time (`180ms`, `.2s`). Choreography (progress
//      bars, content expansion) may keep its own time, so the count of raw times may only go
//      DOWN: below BASELINE, lower BASELINE here; above it, every raw part is listed.
// The property is `transition` or a custom property ending in `-transition` (the retired script
// matched `\btransition\s*:` and so read both).
import { blankStrings, splitTopLevel } from './_css-values.mjs';

export const BASELINE = 20;
const SCALE = 'src/UI/styles/tokens.css';
const COMPOSITE = /var\(--transition-(fast|normal|slow)\)/;
const OWN_CURVE =
  /cubic-bezier|steps\(|var\(--(?:ease|spring)[a-z-]*\)|(?<![\w-])(?:linear|ease-in-out|ease-out|ease-in)(?![\w-])/;
const RAW_TIME = /(?<![\w-])([0-9.]+)(ms|s)(?![\w-])/;

export default {
  name: 'motion-tokens',
  replaces: 'tests/audit/motion-tokens.sh',
  files: ['src/**/*.css'],
  ignores: [SCALE],
  paths: [SCALE],
  presence: { minSites: 350, what: 'transition parts' },
  setup(ctx) {
    ctx.rawTimes = [];
  },
  check(root, ctx) {
    root.walkDecls(decl => {
      const prop = decl.prop.toLowerCase();
      if (
        prop !== 'transition' &&
        !(prop.startsWith('--') && prop.endsWith('-transition'))
      ) {
        return;
      }
      const value = blankStrings(decl.value).replace(/\s+/g, ' ');
      for (const part of splitTopLevel(value)) {
        ctx.site();
        const text = part.trim();
        if (COMPOSITE.test(text) && OWN_CURVE.test(text)) {
          ctx.report(
            decl,
            `dead transition "${text}": var(--transition-*) already carries a curve, a second one makes CSS drop the declaration; own curve → var(--duration-N)`
          );
        }
        if (RAW_TIME.test(text)) {
          ctx.rawTimes.push({ node: decl, file: ctx.file, text });
        }
      }
    });
  },
  finish(ctx) {
    if (ctx.rawTimes.length <= BASELINE) {
      return;
    }
    for (const hit of ctx.rawTimes) {
      ctx.report(
        hit.node,
        `raw time in transition "${hit.text}" (ratchet: ${ctx.rawTimes.length} > baseline ${BASELINE}); use var(--duration-N) or var(--transition-*)`,
        hit.file
      );
    }
  },
};
