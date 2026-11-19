

import {
  blocksOf,
  escapeScope,
  headOf,
  markerState,
  ownDecls,
} from './_scope.mjs';

const ROOT = 'src/UI';
const PALETTE = 'src/UI/styles/themes/palettes.css';
const INK_TOKENS = new Set([
  '--color-ink',
  '--footer-bg',
  '--color-ink-band',
  '--color-ink-band-strong',
  '--color-banner-critical',
  '--color-photo-overlay',
  '--color-photo-overlay-strong',
  '--color-text-primary',
]);
const SELECTION_TOKEN = '--color-text-primary';
const BARE_VAR = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;
const DARK_MODE = /data-mode=['"]?dark['"]?/;

/** The token of a `background` / `background-color` that is exactly `var(--token)`. */
function backgroundToken(decls) {
  for (const d of decls) {
    if (d.prop === 'background' || d.prop === 'background-color') {
      const m = d.value.replace(/\s*!important$/i, '').match(BARE_VAR);
      if (m) {
        return m[1];
      }
    }
  }
  return null;
}

/** Lightness check of the retired script, kept verbatim in behaviour. */
export function isDarkValue(value) {
  const ok = value.match(/oklch\(\s*([0-9.]+)%?/);
  if (ok) {
    const l = parseFloat(ok[1]);
    return (l > 1 ? l / 100 : l) < 0.6;
  }
  const hex = value.match(/#([0-9a-fA-F]{6})\b/);
  if (hex) {
    const c = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16) / 255);
    const f = x =>
      x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) < 0.25;
  }
  return false;
}

function enclosingRules(block) {
  const out = [];
  for (let p = block.parent; p && p.type !== 'root'; p = p.parent) {
    out.push(p);
  }
  return out;
}

function remapValues(block) {
  const values = [];
  for (const container of [block, ...enclosingRules(block)]) {
    for (const d of ownDecls(container)) {
      if (d.prop === '--color-focus-ring') {
        values.push(d.value);
      }
    }
  }
  return values;
}

const isVar = (value, token) => {
  const m = value.match(BARE_VAR);
  return m !== null && m[1] === token;
};

export default {
  name: 'ink-focus-ring',
  replaces: 'tests/audit/ink-focus-ring.sh',
  files: ['src/UI/**/*.module.css'],
  ignores: ['src/UI/**/dev/playground/**'],
  paths: [ROOT, PALETTE],
  presence: {
    minSites: 600,
    what: 'blocks with a background in src/UI modules (measured 884)',
  },
  setup(ctx) {
    if (!ctx.exists(PALETTE)) {
      return;
    }
    // The plane list names palette roles: a renamed role would silently drop out of the rule.
    // `--footer-bg` is a module alias (PublicLayout), not a palette role.
    const palette = ctx.read(PALETTE);
    const roles = [
      ...INK_TOKENS,
      '--color-primary',
      '--color-accent-on-ink',
      '--color-bg-main',
    ];
    for (const role of roles.filter(r => r !== '--footer-bg')) {
      if (!new RegExp(`${role}\\s*:`).test(palette)) {
        ctx.error(
          `${PALETTE} no longer defines ${role}; update the plane list of this rule`
        );
      }
    }
  },
  check(root, ctx) {
    const firstDefinition = new Map();
    root.walkDecls(decl => {
      if (decl.prop.startsWith('--') && !firstDefinition.has(decl.prop)) {
        firstDefinition.set(decl.prop, decl.value);
      }
    });
    for (const block of blocksOf(root)) {
      if (block.type !== 'rule') {
        continue;
      }
      const decls = ownDecls(block);
      const token = backgroundToken(decls);
      if (
        !decls.some(
          d => d.prop === 'background' || d.prop === 'background-color'
        )
      ) {
        continue;
      }
      ctx.site();
      const heads = [block, ...enclosingRules(block)]
        .filter(c => c.type === 'rule')
        .map(c => c.selector);
      if (heads.some(selector => DARK_MODE.test(selector))) {
        continue;
      }
      let plane = null;
      if (token && INK_TOKENS.has(token)) {
        plane = token === SELECTION_TOKEN ? 'selection' : 'ink';
      } else if (
        token === '--color-primary' &&
        decls.some(d => d.prop === 'width' && /^100vw$/i.test(d.value))
      ) {
        plane = 'gold band';
      } else if (
        token &&
        block.parent?.type === 'root' &&
        !(block.nodes ?? []).some(n => n.nodes) &&
        decls.some(d => d.prop === 'color') &&
        firstDefinition.has(token) &&
        isDarkValue(firstDefinition.get(token))
      ) {
        plane = 'dark band via alias';
      }
      if (!plane) {
        continue;
      }
      const marker = markerState(escapeScope(block), 'focus-ring-allow');
      if (marker === 'reason') {
        continue;
      }
      // A bare marker exempts nothing (the block is judged as if it had none), as before.
      const bare =
        marker === 'bare'
          ? ' (focus-ring-allow without a reason exempts nothing)'
          : '';
      const label = `[${plane}] ${headOf(block)}`;
      const remaps = remapValues(block);
      if (remaps.length === 0) {
        const fix =
          plane === 'gold band'
            ? '--color-focus-ring: var(--color-ink)'
            : plane === 'selection'
              ? '--color-focus-ring: var(--color-bg-main) (ring inside the fill) or focus-ring-allow: <reason> (ring outside)'
              : '--color-focus-ring: var(--color-accent-on-ink)';
        ctx.report(
          block,
          `${label}  focus ring not remapped (1:1 on this plane); add ${fix}${bare}`
        );
        continue;
      }
      if (
        plane !== 'gold band' &&
        remaps.some(v => isVar(v, '--color-primary'))
      ) {
        ctx.report(
          block,
          `${label}  ring remapped to --color-primary (3.6:1 on ink); use var(--color-accent-on-ink)`
        );
      }
      if (
        plane === 'selection' &&
        remaps.some(v => isVar(v, '--color-accent-on-ink'))
      ) {
        ctx.report(
          block,
          `${label}  ring remapped to --color-accent-on-ink (1.87:1 on the light fill in DARK); use var(--color-bg-main) or focus-ring-allow`
        );
      }
    }
  },
};
