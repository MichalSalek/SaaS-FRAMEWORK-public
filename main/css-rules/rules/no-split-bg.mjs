// css/no-split-bg — no two-colour section band split by a percentage width.
//
// Successor of tests/audit/no-split-bg.sh. Owner: a vertical (or mirrored) band of a
// second colour over N% of a hero or section cuts the copy, lands crooked across viewports and
// reads as AI slop. The signature: pinned full-height to one side (`inset: 0 0 0 auto` or
// `inset: 0 auto 0 0`) + a LITERAL percentage width + a background. Not matched: a photo panel
// (`width: min(42vw, …)`), a progress fill (`width: var(--limit-pct)`), a skeleton line (a percent
// width without the edge pin), a full ink/gold band (one colour for the whole section).
// As in the shell scanner, a block is judged with the declarations of its nested blocks too (the
// old body included them), so the pin and the fill cannot be split across a nesting level.
// Escape: `split-bg-allow: <reason>` in the block, right above it or above an enclosing block.
// DECISION: the reason is now mandatory (the shell marker accepted a bare one; no exception in the
// tree used it) and a bare marker is its own finding, the contract of every other escape here.
import { declsNamed, isZero, valueTokens } from './_box.mjs';
import { blocksOf, escapeScope, headOf, markerState } from './_scope.mjs';

const ROOT = 'src/UI';

function deepDecls(block) {
  const decls = [];
  block.walkDecls(decl => {
    decls.push({ prop: decl.prop.toLowerCase(), value: decl.value.trim() });
  });
  return decls;
}

function isSidePinnedPercentBand(decls) {
  const insetPin = declsNamed(decls, 'inset').some(d => {
    const t = valueTokens(d.value);
    return (
      t.length >= 4 &&
      isZero(t[0]) &&
      isZero(t[2]) &&
      ((isZero(t[1]) && t[3] === 'auto') || (t[1] === 'auto' && isZero(t[3])))
    );
  });
  // Literal percentage only: var()/min()/clamp() are layout or progress.
  const percentWidth = declsNamed(decls, 'width').some(d =>
    /^\d*\.?\d+%/.test(d.value)
  );
  const hasFill = decls.some(d => /(^|-)background(-color)?$/.test(d.prop));
  return insetPin && percentWidth && hasFill;
}

export default {
  name: 'no-split-bg',
  replaces: 'tests/audit/no-split-bg.sh',
  files: ['src/UI/**/*.css'],
  ignores: ['src/UI/**/playground/**'],
  paths: [ROOT],
  presence: {
    minSites: 800,
    what: 'blocks with a width in src/UI stylesheets (measured 1189)',
  },
  check(root, ctx) {
    for (const block of blocksOf(root)) {
      const decls = deepDecls(block);
      if (declsNamed(decls, 'width').length === 0) {
        continue;
      }
      ctx.site();
      if (!isSidePinnedPercentBand(decls)) {
        continue;
      }
      const marker = markerState(escapeScope(block), 'split-bg-allow');
      if (marker === 'reason') {
        continue;
      }
      const label = headOf(block) || '?';
      ctx.report(
        block,
        marker === 'bare'
          ? `[${label}]  split-bg-allow without a reason: an exception nobody can verify in review`
          : `[${label}]  two-colour %-width band: keep ONE solid background per section or card`
      );
    }
  },
};
