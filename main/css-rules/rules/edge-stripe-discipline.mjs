

import { declsNamed, isZero, valueTokens } from './_box.mjs';
import {
  blocksOf,
  escapeScope,
  headOf,
  markerState,
  ownDecls,
} from './_scope.mjs';

const ROOT = 'src/UI';
const has = (decls, prop) => decls.some(d => d.prop === prop);

function insetTokens(decls) {
  return declsNamed(decls, 'inset').map(d => valueTokens(d.value));
}

function isThinVerticalBar(decls) {
  if (!declsNamed(decls, 'width').some(d => /^[1-6]px\b/.test(d.value))) {
    return false;
  }
  const insetPin = insetTokens(decls).some(
    t => t.length >= 4 && ((t[1] === 'auto' && isZero(t[3])) || t[3] === 'auto')
  );
  const longPin =
    decls.some(
      d => (d.prop === 'left' || d.prop === 'right') && isZero(d.value)
    ) &&
    has(decls, 'top') &&
    has(decls, 'bottom');
  return insetPin || longPin;
}

function isThinHorizontalBar(decls) {
  if (
    !declsNamed(decls, 'height').some(d =>
      /^(?:[1-8]px\b|clamp\(\s*[1-8]px)/.test(d.value)
    )
  ) {
    return false;
  }
  const insetPin = insetTokens(decls).some(
    t => t.length >= 3 && (t[0] === 'auto' || t[2] === 'auto')
  );
  const longPin =
    decls.some(
      d => (d.prop === 'top' || d.prop === 'bottom') && isZero(d.value)
    ) &&
    has(decls, 'left') &&
    has(decls, 'right');
  return insetPin || longPin;
}

const hasNeutralFill = decls =>
  decls.some(
    d =>
      (d.prop === 'background' || d.prop === 'background-color') &&
      (/var\(\s*--color-(divider|line|border|surface)/.test(d.value) ||
        /^none\b/.test(d.value))
  );

export default {
  name: 'edge-stripe-discipline',
  replaces: 'tests/audit/edge-stripe-discipline.sh',
  files: ['src/UI/**/*.module.css'],
  ignores: ['src/UI/**/playground/**'],
  paths: [ROOT],
  presence: {
    minSites: 1200,
    what: 'blocks with a width or height in src/UI modules (measured 1825)',
  },
  check(root, ctx) {
    for (const block of blocksOf(root)) {
      const decls = ownDecls(block);
      if (
        declsNamed(decls, 'width').length > 0 ||
        declsNamed(decls, 'height').length > 0
      ) {
        ctx.site();
      }
      if (
        !(isThinVerticalBar(decls) || isThinHorizontalBar(decls)) ||
        hasNeutralFill(decls)
      ) {
        continue;
      }
      const label = headOf(block) || '?';
      const marker = markerState(escapeScope(block), 'edge-stripe-allow');
      if (marker === 'reason') {
        continue;
      }
      ctx.report(
        block,
        marker === 'bare'
          ? `[${label}]  edge-stripe-allow without a reason: an exception nobody can verify in review`
          : `[${label}]  one-sided accent stripe: use a full 4-sided hairline, a tonal surface plus a label, or a status dot`
      );
    }
  },
};
