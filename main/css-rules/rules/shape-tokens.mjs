

import { blankStrings, markerNear } from './_css-values.mjs';

const SCALE = 'src/UI/styles/tokens.css';
const SIDE =
  '(?:-(?:top|bottom|left|right|block|inline|block-start|block-end|inline-start|inline-end))?';
const R1 = /var\(--radius-[a-z]+\s*[,)]/;
const RADIUS_PROP = /(?:^|-)border-(?:[a-z]+-)*radius$/;
const R2 = /(?:^|[^\w.])(?:[1-9][0-9]*(?:\.[0-9]+)?|0?\.[0-9]+)(?:px|rem|em|%)/;
const CASE_PROP = /(?:^|-)text-transform$/;
const VARIANT_PROP = /(?:^|-)font-variant(?:-caps)?$/;
const SMALL_CAPS = /^(?:all-)?(?:small|petite)-caps\b/;
const BORDER_PROP = new RegExp(`(?:^|-)border${SIDE}(?:-width)?$`);
const R4 = /^(?:[a-z]+\s+)?(?!0(?:px)?\b)[0-9.]+px\b/;
const OUTLINE_PROP = /(?:^|-)outline$/;
const R5 = /^(?:[a-z]+\s+)?[0-9.]+px\b/;

const MESSAGES = {
  R1: 'old --radius-* scale; use a role: --style-radius-control/-surface/-pill/-avatar/-medallion/-round',
  R2: 'raw border-radius; use a --style-radius-* role',
  R3: 'small caps written out; use var(--style-label-case) (kicker: var(--style-kicker-case))',
  R4: 'raw line width; use --style-border-surface / -control / -divider',
  R5: 'outline as a frame (outside :focus); use a border with --style-border-surface',
};

/** Rule ids a declaration breaks. */
export function shapeViolations(decl) {
  const prop = decl.prop.toLowerCase();
  const value = blankStrings(decl.value).trim();
  const hits = [];
  if (R1.test(value)) {
    hits.push('R1');
  }
  if (RADIUS_PROP.test(prop) && R2.test(value)) {
    hits.push('R2');
  }
  if (
    (CASE_PROP.test(prop) && /^uppercase\b/i.test(value)) ||
    (VARIANT_PROP.test(prop) && SMALL_CAPS.test(value))
  ) {
    hits.push('R3');
  }
  if (BORDER_PROP.test(prop) && R4.test(value)) {
    hits.push('R4');
  }
  if (OUTLINE_PROP.test(prop) && R5.test(value)) {
    const head = decl.parent?.type === 'rule' ? decl.parent.selector : '';
    if (!/focus/.test(head)) {
      hits.push('R5');
    }
  }
  return hits;
}

const SITE_PROP = /(?:^|-)(?:border|outline|text-transform|font-variant)/;

export default {
  name: 'shape-tokens',
  replaces: 'tests/audit/shape-tokens.sh (stylesheets)',
  files: ['src/UI/**/*.css', 'src/pages/**/*.css'],
  ignores: [SCALE],
  paths: [SCALE, 'src/UI', 'src/pages'],
  presence: {
    minSites: 1200,
    what: 'border, radius, outline and case declarations',
  },
  check(root, ctx) {
    root.walkDecls(decl => {
      if (SITE_PROP.test(decl.prop.toLowerCase()) || R1.test(decl.value)) {
        ctx.site();
      }
      const hits = shapeViolations(decl);
      if (hits.length === 0) {
        return;
      }
      const state = markerNear(decl, 'shape-allow', 3);
      if (state === 'reason') {
        return;
      }
      for (const id of hits) {
        ctx.report(
          decl,
          state === 'bare'
            ? `[${id}] "shape-allow:" without a reason does not escape: ${MESSAGES[id]}`
            : `[${id}] ${MESSAGES[id]}`
        );
      }
    });
  },
};
