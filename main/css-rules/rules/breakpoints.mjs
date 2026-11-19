

import { markerNear } from './_css-values.mjs';

export const BASELINE = 42;
const CANON = new Set([480, 479, 768, 767, 1024, 1023, 1279, 1280]);
const WIDTH = /(min|max)-width:\s*(\d+)px/g;

export default {
  name: 'breakpoints',
  replaces: 'tests/audit/breakpoints.sh',
  files: ['src/**/*.css'],
  ignores: [],
  paths: [],
  presence: { minSites: 120, what: 'width conditions of @media rules' },
  setup(ctx) {
    ctx.offGrid = [];
  },
  check(root, ctx) {
    root.walkAtRules('media', atRule => {
      const params = atRule.params.replace(
        /(["'])(?:\\.|(?!\1)[^\\])*\1/g,
        '""'
      );
      const conditions = [...params.matchAll(WIDTH)];
      if (conditions.length === 0) {
        return;
      }
      const state = markerNear(atRule, 'breakpoint-allow', 4);
      for (const match of conditions) {
        ctx.site();
        const px = parseInt(match[2], 10);
        if (CANON.has(px) || state === 'reason') {
          continue;
        }
        ctx.offGrid.push({
          node: atRule,
          file: ctx.file,
          message:
            state === 'bare'
              ? `"breakpoint-allow:" without a reason does not escape ${match[1]}-width: ${px}px`
              : `off-grid ${match[1]}-width: ${px}px; use 480/768/1024/1280 (max-width: 479/767/1023/1279) or /* breakpoint-allow: <reason> */`,
        });
      }
    });
  },
  finish(ctx) {
    if (ctx.offGrid.length <= BASELINE) {
      return;
    }
    for (const hit of ctx.offGrid) {
      ctx.report(
        hit.node,
        `${hit.message} (ratchet: ${ctx.offGrid.length} > baseline ${BASELINE})`,
        hit.file
      );
    }
  },
};
