// css/fluid-type — a fluid font size comes from the --text-fluid-* scale, not a module's own clamp.
//
// Successor of tests/audit/fluid-type.sh (ratchet closed at zero). The census found
// 219 hand-rolled `font-size: clamp(…)` in 124 different spellings (41 variants of one section
// heading); they went onto the eight --text-fluid-* steps. Reported: a `font-size` declaration in a
// CSS module whose value is a clamp(). The scale itself lives in tokens.css (not a module). A size
// deliberately off the scale carries `/* fluid-allow: <reason> */` on the declaration line or up to
// four lines above it; a bare marker without a reason does not escape.
import { blankStrings, markerNear } from './_css-values.mjs';

export default {
  name: 'fluid-type',
  replaces: 'tests/audit/fluid-type.sh',
  files: ['src/**/*.module.css'],
  ignores: [],
  paths: [],
  presence: { minSites: 800, what: 'font-size declarations in CSS modules' },
  check(root, ctx) {
    root.walkDecls(decl => {
      if (decl.prop.toLowerCase() !== 'font-size') {
        return;
      }
      ctx.site();
      if (!/^clamp\(/i.test(blankStrings(decl.value).trim())) {
        return;
      }
      const state = markerNear(decl, 'fluid-allow', 4);
      if (state === 'reason') {
        return;
      }
      ctx.report(
        decl,
        state === 'bare'
          ? '"fluid-allow:" without a reason does not escape a hand-rolled font-size clamp()'
          : 'hand-rolled font-size clamp(); take a --text-fluid-* step (tokens.css) or /* fluid-allow: <reason> */'
      );
    });
  },
};
