

import {
  blocksOf,
  escapeScope,
  headOf,
  markerState,
  ownDecls,
} from './_scope.mjs';
import {
  CREAM,
  MODULE_IGNORES,
  MODULE_ROOT,
  PALETTE_FILES,
  buildThemeSets,
  chromatic,
  goldShare,
  isAccentToken,
  rawColorTint,
  expandHex,
  varDecls,
} from './_tint.mjs';

// Shared primitives that may carry the cream band: the section band and the app hero ARE the
// one band of the page that mounts them (owner).
const CREAM_PRIMITIVES = [
  'src/UI/components/Section/Section.module.css',
  'src/UI/components/AppHero/AppHero.module.css',
];
const SHARED_PRIMITIVES = /(^|\/)UI\/components\//;

const BG_PROPS = new Set([
  'background',
  'background-color',
  'background-image',
]);
const SURFACE_PROPS = new Set([
  ...BG_PROPS,
  'stroke',
  'fill',
  'border-image',
  'border-image-source',
]);
const BORDER_PROP =
  /^(border|border-color|border-(top|right|bottom|left)(-color)?|border-(inline|block)(-(start|end))?(-color)?|outline|outline-color)$/;
const ZEBRA_SEL =
  /:nth-(?:child|of-type|last-child|last-of-type)\(\s*(?:even|odd|\d*n)/;
const URL_HEX = /%23([0-9a-fA-F]{6})\b/;
const DIRECT_VAR = /^var\(\s*--([a-z0-9-]+)\s*\)$/;
const MARKERS = ['tint-allow', 'ink-border-allow', 'table-layout-auto'];

// A spread or blur of 20px+ paints a plane; below it the shadow is a hairline ring.
function isWashShadow(prop, value) {
  if (prop !== 'box-shadow') {
    return false;
  }
  return (value.match(/-?\d*\.?\d+px/g) || []).some(
    l => Math.abs(parseFloat(l)) >= 20
  );
}

function opacityOf(decls) {
  const direct = decls.find(d => d.prop === 'opacity');
  if (direct) {
    return { shown: direct.value, value: Number(direct.value) };
  }
  const filter = decls.find(d => d.prop === 'filter');
  if (filter) {
    const m = filter.value.match(/(?:^|[\s(])opacity\(\s*(\d*\.?\d+)(%?)\s*\)/);
    if (m) {
      return {
        shown: m[1] + m[2],
        value: m[2] === '%' ? Number(m[1]) / 100 : Number(m[1]),
      };
    }
  }
  return null;
}

function localSets(blocks, gold, globalCream) {
  const localGold = new Set();
  const localCream = new Set();
  const localAccent = new Set();
  const localTints = new Set();
  const isGold = n => gold.has(n) || localGold.has(n);
  // Three passes: an alias may stand in the file BEFORE what it aliases.
  for (let pass = 0; pass < 3; pass++) {
    for (const block of blocks) {
      for (const d of varDecls(block)) {
        const direct = d.value.match(DIRECT_VAR);
        if (
          direct &&
          (direct[1] === CREAM ||
            globalCream.has(direct[1]) ||
            localCream.has(direct[1]))
        ) {
          localCream.add(d.name);
          continue;
        }
        if (direct && isGold(direct[1])) {
          localGold.add(d.name);
          localAccent.add(d.name);
          continue;
        }
        // A variable holding a bare CHROMATIC hex is a page accent (`--client-rose: #e16a8c`).
        const bare = d.value.match(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
        if (bare && chromatic(expandHex(bare[0].slice(1)))) {
          localAccent.add(d.name);
          continue;
        }
        if (direct && isAccentToken(direct[1], isGold, localAccent)) {
          localAccent.add(d.name);
          continue;
        }
        if (/color-mix\(/.test(d.value)) {
          const g = goldShare(d.value, gold, localGold, localAccent);
          if (g && typeof g.share === 'number' && g.share <= 45) {
            localTints.add(d.name);
          }
        }
        if (rawColorTint(d.value)) {
          localTints.add(d.name);
        }
      }
    }
  }
  return { localGold, localCream, localAccent, localTints };
}

/** First surface finding of a block, or null. */
function surfaceFinding(decls, env) {
  const {
    allowed,
    tinySize,
    opacity,
    sets,
    gold,
    creamRe,
    rel,
    key,
    creamSeen,
  } = env;
  const opacityLow = opacity ? opacity.value > 0 && opacity.value < 0.9 : false;
  for (const d of decls) {
    env.ctx.site();
    const urlHex = d.value.match(URL_HEX);
    if (urlHex && chromatic(urlHex[1])) {
      return `URL-encoded brand colour (${urlHex[0]}); it also escapes the hex policy`;
    }
    if (!SURFACE_PROPS.has(d.prop) && !isWashShadow(d.prop, d.value)) {
      continue;
    }
    if (!allowed && !tinySize) {
      const g = goldShare(d.value, gold, sets.localGold, sets.localAccent);
      if (
        g &&
        (g.share === 'variable' || g.share <= 45) &&
        (BG_PROPS.has(d.prop) || g.share !== 100)
      ) {
        const share = g.share === 'variable' ? 'variable' : `${g.share}%`;
        return `background tint (${g.token} ${share}) without a role token`;
      }
      if (g && g.share === 100 && opacityLow && BG_PROPS.has(d.prop)) {
        return `solid gold + opacity ${opacity.shown} = the same wash as a tint`;
      }
      const raw = rawColorTint(d.value);
      if (raw) {
        return `raw colour function with alpha ${raw.alpha} (${raw.fn}): a tint outside the token system; R7 (state) does not exempt a raw value, use the token`;
      }
      const local = [...sets.localTints].find(nm =>
        new RegExp(`var\\(\\s*--${nm}\\s*\\)`).test(d.value)
      );
      if (local) {
        return `tint through the local variable --${local} (own cream ladder, R2)`;
      }
    }
    // R2: cream. Shared primitives do NOT carry it.
    if (creamRe.test(d.value) && !allowed) {
      if (SHARED_PRIMITIVES.test(rel) && !CREAM_PRIMITIVES.includes(rel)) {
        return 'cream in a shared primitive: it multiplies across every screen (R2, vote S98/A)';
      }
      if (!SHARED_PRIMITIVES.test(rel) && !creamSeen.has(key)) {
        creamSeen.add(key);
        if (creamSeen.size > 1) {
          return 'SECOND cream in the module: one cream band per page (R2)';
        }
      }
    }
  }
  return null;
}

export default {
  name: 'tint-discipline',
  replaces: 'tests/audit/tint-discipline.sh',
  files: ['src/UI/**/*.module.css'],
  ignores: MODULE_IGNORES,
  paths: [MODULE_ROOT, ...PALETTE_FILES, ...CREAM_PRIMITIVES],
  presence: {
    minSites: 15000,
    what: 'declarations inspected in src/UI modules (measured 20702)',
  },
  setup(ctx) {
    ctx.modules = [];
  },
  check(root, ctx) {
    ctx.modules.push({ rel: ctx.file, root });
  },
  finish(ctx) {
    const parseRel = rel => (ctx.exists(rel) ? ctx.parse(rel) : null);
    const { gold, globalCream } = buildThemeSets(
      parseRel,
      ctx.modules.map(m => m.rel)
    );
    for (const { rel, root } of ctx.modules) {
      const blocks = blocksOf(root);
      const sets = localSets(blocks, gold, globalCream);
      const creamRe = new RegExp(
        `var\\(\\s*--(?:${[CREAM, ...globalCream, ...sets.localCream].join('|')})\\s*\\)`
      );
      const creamSeen = new Set();
      for (const block of blocks) {
        const decls = ownDecls(block);
        const isLeaf = !(block.nodes ?? []).some(node => node.nodes);
        if (decls.length === 0 && !isLeaf) {
          continue; // a wrapper (@media, a nesting parent): its children are blocks of their own
        }
        const head = headOf(block);
        const chain = [];
        for (let p = block.parent; p && p.type !== 'root'; p = p.parent) {
          chain.unshift(headOf(p));
        }
        chain.push(head);
        const selChain = chain.join(' ');
        const label = head || '?';
        const report = message =>
          ctx.report(block, `[${label}]  ${message}`, rel);
        const scope = escapeScope(block);
        const bare = MARKERS.find(
          marker => markerState(scope, marker) === 'bare'
        );
        if (bare) {
          report(
            `${bare} without a reason: an exception nobody can verify in review`
          );
          continue;
        }
        const tinySize = decls.some(
          d => /^(height|width)$/.test(d.prop) && /^([1-6])px$/.test(d.value)
        );
        const found = surfaceFinding(decls, {
          ctx,
          allowed: markerState(scope, 'tint-allow') === 'reason',
          tinySize,
          opacity: opacityOf(decls),
          sets,
          gold,
          creamRe,
          rel,
          key: head.replace(/:root\[data-mode='dark'\]\s*/g, '').trim(),
          creamSeen,
        });
        if (found) {
          report(found);
          continue;
        }
        if (ZEBRA_SEL.test(selChain) && decls.some(d => BG_PROPS.has(d.prop))) {
          report('zebra (R4): list rhythm is hairline + spacing');
          continue;
        }
        if (
          !/data-mode=['"]?dark/.test(selChain) &&
          markerState(scope, 'ink-border-allow') !== 'reason'
        ) {
          const ink = decls.find(
            d =>
              BORDER_PROP.test(d.prop) &&
              /var\(\s*--color-ink\s*\)/.test(d.value) &&
              !/color-mix\(/.test(d.value)
          );
          if (ink) {
            report(
              '--color-ink as a frame (R8): dark in BOTH modes, the accent vanishes in dark'
            );
            continue;
          }
        }
        if (
          decls.some(d => d.prop === 'border-collapse') &&
          !decls.some(d => d.prop === 'table-layout') &&
          markerState(scope, 'table-layout-auto') !== 'reason'
        ) {
          report('table without a table-layout decision (R10)');
        }
      }
    }
  },
};
