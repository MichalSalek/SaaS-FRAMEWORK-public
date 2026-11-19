

import { escapeScope, headOf, markerState } from './_scope.mjs';

const ROOT = 'src/UI';
const DISABLED_TOKEN = /var\(\s*--color-text-disabled\s*[,)]/;
const DISABLED_SEL =
  /:disabled|\[disabled|\[aria-disabled|aria-disabled|disabled|Disabled/;

function enclosingBlocks(decl) {
  const out = [];
  for (let p = decl.parent; p && p.type !== 'root'; p = p.parent) {
    out.push(p);
  }
  return out;
}

export default {
  name: 'disabled-text-contrast',
  replaces: 'tests/audit/disabled-text-contrast.sh',
  files: ['src/UI/**/*.module.css'],
  ignores: ['src/UI/**/playground/**'],
  paths: [ROOT],
  presence: {
    minSites: 1000,
    what: 'text color declarations in src/UI modules (measured 1550; 3 on the disabled token)',
  },
  check(root, ctx) {
    root.walkDecls(decl => {
      if (decl.prop.toLowerCase() !== 'color') {
        return;
      }
      // Every text colour is a candidate: the token has three legal uses today, too few for a
      // floor that would notice a scan reading the wrong root.
      ctx.site();
      if (!DISABLED_TOKEN.test(decl.value)) {
        return;
      }
      const blocks = enclosingBlocks(decl);
      if (blocks.some(block => DISABLED_SEL.test(headOf(block)))) {
        return;
      }
      const block = blocks[0];
      const marker = block
        ? markerState(escapeScope(block), 'text-disabled-allow')
        : null;
      if (marker === 'reason') {
        return;
      }
      const label = block ? headOf(block) : '?';
      ctx.report(
        decl,
        marker === 'bare'
          ? `[${label}]  text-disabled-allow without a reason exempts nothing`
          : `[${label}]  readable text on --color-text-disabled (about 2:1): use --color-text-muted, a :disabled selector, or text-disabled-allow: <reason>`
      );
    });
  },
};
