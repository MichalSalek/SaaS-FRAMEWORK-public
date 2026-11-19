// css/min-font-size — no raw font size below the 16px floor in a stylesheet (owner hard directive).
//
// Successor of the stylesheet half of tests/audit/min-font-size.sh (the .ts/.tsx half, inline
// fontSize and CSS text inside strings, is nf/min-font-size in eslint-rules). Root: every
// stylesheet under src. Reported: a `font-size` declaration (also a custom property whose name ends
// in `-font-size`, as the retired grep read it) whose value breaks the floor (see _font-floor.mjs).
// No escape marker: the old script had none, the floor has no exception but the scale itself.
import { blankStrings } from './_css-values.mjs';
import { fontFloorViolation } from './_font-floor.mjs';

const ALLOWLIST = {
  // The type-scale SSOT: token DEFINITIONS (--text-xs = 14px), not usages; DECISION in tokens.css.
  'src/UI/styles/tokens.css': 'type-scale definitions',
};
const FONT_SIZE_PROP = /(?:^|-)font-size$/;

export default {
  name: 'min-font-size',
  replaces: 'tests/audit/min-font-size.sh (stylesheets)',
  files: ['src/**/*.css'],
  ignores: Object.keys(ALLOWLIST),
  paths: Object.keys(ALLOWLIST),
  presence: { minSites: 800, what: 'font-size declarations in stylesheets' },
  check(root, ctx) {
    root.walkDecls(decl => {
      if (!FONT_SIZE_PROP.test(decl.prop.toLowerCase())) {
        return;
      }
      ctx.site();
      const why = fontFloorViolation(blankStrings(decl.value));
      if (why) {
        ctx.report(
          decl,
          `${decl.prop}: ${why}; use a --text-* token (DESIGN.md → Typografia)`
        );
      }
    });
  },
};
