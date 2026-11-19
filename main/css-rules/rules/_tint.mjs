

import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { blocksOf } from './_scope.mjs';

// Gold seed: the brand tokens. Aliases are the problem, not a curiosity: --color-accent and
// --color-cta are literal `var(--color-primary)` in palettes.css, so a tint through them renders
// the same while a scan by the name "primary" misses it.
export const GOLD_SEED = [
  'color-primary',
  'color-secondary',
  'color-accent',
  'color-cta',
  'color-accent-fg',
  'color-accent-hover',
];
// ROLE tokens = the sanctioned outputs of the theme. They are derived from gold, so without this
// list the guard would shout at the very fix it points to.
export const ROLE_TOKENS = new Set([
  'color-mark-bg',
  'color-mark-bg-strong',
  'color-mark-bg-on-ink',
  'color-state-selected',
  'color-state-hover',
  'color-bg-subtle',
]);
// The one sanctioned off-white band, limited to ONE per page (R2).
export const CREAM = 'color-bg-subtle';

export const PALETTE_FILES = [
  'src/UI/styles/themes/palettes.css',
  'src/UI/styles/tokens.css',
];
export const MODULE_ROOT = 'src/UI';
export const MODULE_GLOB = 'src/UI/**/*.module.css';
export const MODULE_IGNORES = ['src/UI/**/dev/playground/**'];

const DIRECT_VAR = /^var\(\s*--([a-z0-9-]+)\s*\)$/;

/**
 * Custom-property declarations of a container: `--x: …` and the `initial-value` of
 * `@property --x` (a registration names the variable in its HEAD).
 * @param {import('postcss').Container} container
 */
export function varDecls(container) {
  const pairs = [];
  const decls = (container.nodes ?? []).filter(n => n.type === 'decl');
  if (container.type === 'atrule' && container.name === 'property') {
    const name = container.params.trim().match(/^--([a-z0-9-]+)/);
    const iv = decls.find(d => d.prop.toLowerCase() === 'initial-value');
    if (name && iv) {
      pairs.push({ name: name[1], value: iv.value.trim() });
    }
  }
  for (const d of decls) {
    if (d.prop.startsWith('--')) {
      pairs.push({ name: d.prop.slice(2), value: d.value.trim() });
    }
  }
  return pairs;
}

/**
 * Document scope: `:root` / `:host` (the cascade knows no file boundary) and `@property`
 * (registration is global). Anything else is a class scope, hashed per file by CSS Modules.
 */
export function isDocumentScoped(container) {
  if (container.type === 'atrule') {
    return (
      container.name === 'property' &&
      /^--[a-z0-9-]+/.test(container.params.trim())
    );
  }
  if (container.type !== 'rule') {
    return false;
  }
  const head = container.selector.replace(/\s+/g, ' ').trim();
  return /(^|,)\s*(:root|:host)\b/.test(head);
}

/**
 * Gold and cream sets of the document scope: the seed, literal aliases in the palette and tokens
 * files, and `:root` / `:host` / `@property` aliases in every module.
 * @param {(rel: string) => import('postcss').Root | null} parseRel
 * @param {string[]} moduleFiles
 */
export function buildThemeSets(parseRel, moduleFiles) {
  const gold = new Set(GOLD_SEED);
  for (const rel of PALETTE_FILES) {
    const root = parseRel(rel);
    if (!root) {
      continue; // a mini project without a palette: the seed is enough
    }
    // Only LITERAL aliases (`--x: var(--y)`), never color-mix derivatives: those are the role
    // tokens that are allowed to carry gold.
    const aliases = [];
    root.walkDecls(d => {
      const direct =
        d.prop.startsWith('--') && d.value.trim().match(DIRECT_VAR);
      if (direct) {
        aliases.push({ name: d.prop.slice(2), target: direct[1] });
      }
    });
    for (let pass = 0; pass < 4; pass++) {
      for (const { name, target } of aliases) {
        if (gold.has(target) && !ROLE_TOKENS.has(name)) {
          gold.add(name);
        }
      }
    }
  }
  const globalCream = new Set();
  const globalAliases = [];
  for (const rel of moduleFiles) {
    const root = parseRel(rel);
    if (!root) {
      continue;
    }
    for (const container of blocksOf(root)) {
      if (!isDocumentScoped(container)) {
        continue;
      }
      for (const d of varDecls(container)) {
        const direct = d.value.match(DIRECT_VAR);
        if (direct) {
          globalAliases.push({ name: d.name, target: direct[1] });
        }
      }
    }
  }
  // Three passes: an alias may point at an alias defined in a file later in the scan order.
  for (let pass = 0; pass < 3; pass++) {
    for (const { name, target } of globalAliases) {
      if (ROLE_TOKENS.has(name)) {
        continue;
      }
      if (target === CREAM || globalCream.has(target)) {
        globalCream.add(name);
      } else if (gold.has(target)) {
        gold.add(name);
      }
    }
  }
  return { gold, globalCream };
}

/** Theme sets of a workspace on disk (used by the inline-style lint rule), cached per cwd. */
const diskCache = new Map();
export function themeSetsFromDisk(cwd) {
  if (!diskCache.has(cwd)) {
    const parseRel = rel => {
      const abs = path.join(cwd, rel);
      if (!existsSync(abs)) {
        return null;
      }
      try {
        return postcss.parse(readFileSync(abs, 'utf8'), { from: rel });
      } catch {
        return null; // a broken stylesheet is css/tint-discipline's finding, not this rule's
      }
    };
    const modules = globSync(MODULE_GLOB, { cwd, exclude: MODULE_IGNORES })
      .map(rel => rel.split(path.sep).join('/'))
      .sort();
    diskCache.set(cwd, buildThemeSets(parseRel, modules));
  }
  return diskCache.get(cwd);
}

// ─── Gold share of a value ─────────────────────────────────────────────────────────────────────
// Forms of the same tint:
//   var(--gold) 12%                 percent after the colour
//   12% var(--gold)                 percent BEFORE the colour (CSS Color 5 does not fix the order)
//   var(--gold) var(--mix, 18%)     the share hidden in a variable
//   var(--gold) .12e2%              exponent notation
//   color-mix(…, var(--paper) 92%, var(--gold))  gold as the REMAINDER
//   rgb(from var(--gold) r g b / .08)            relative colour, the ALPHA carries the share
const NUM = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?';
// A mix base written as a LITERAL is seen together with its percent:
// `color-mix(in oklch, transparent 88%, var(--color-primary))` is 12% gold, not 100%.
const BASE_LITERAL =
  /\btransparent\b|\bwhite\b|\bblack\b|#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const PCT_AFTER_LITERAL = new RegExp(`^\\s*(${NUM})%`);
const PCT_AFTER = new RegExp(`^[^,)]*\\)\\s*(${NUM})%`);
const PCT_BEFORE = new RegExp(`[,(]\\s*(${NUM})%\\s*$`);
const REL_COLOR = new RegExp(
  `\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\(\\s*from\\s+var\\(\\s*--([a-z0-9-]+)\\s*\\)([^()]*)\\)`,
  'g'
);
const REL_ALPHA = new RegExp(`\\/\\s*(${NUM})(%?)\\s*$`);

/** True for a hex whose channels spread by more than 12 (a colour, not white/black/grey). */
export function chromatic(hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) > 12;
}
export function expandHex(h) {
  return h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
}

// The ACCENT is a closed LIST and everything else is a mix base. Asking the other way round
// ("is the base a surface token") let every other neutral token through: `color-mix(in oklch,
// var(--color-border) 92%, var(--color-primary))` renders 8% gold.
export function isAccentToken(token, isGold, localAccent) {
  if (isGold(token) || (localAccent && localAccent.has(token))) {
    return true;
  }
  if (/^color-text-/.test(token)) {
    return false;
  }
  return /(^|-)(accent|primary|secondary|cta|brand|hue|error|warning|danger|success|info|mark)(-|$)/.test(
    token
  );
}

function relativeShare(value, isGold) {
  REL_COLOR.lastIndex = 0;
  let m;
  while ((m = REL_COLOR.exec(value)) !== null) {
    const name = m[1];
    if (!isGold(name) || ROLE_TOKENS.has(name)) {
      continue;
    }
    const alpha = m[2].match(REL_ALPHA);
    if (!alpha) {
      return { token: name, share: 100 };
    }
    const raw = Number(alpha[1]);
    return { token: name, share: alpha[2] === '%' ? raw : raw * 100 };
  }
  return null;
}

/**
 * Gold share of a value: `{ token, share }` where share is a number (percent), 'variable' (the
 * percent sits in a var()) or null when the value carries no gold.
 */
export function goldShare(value, gold, localGold, localAccent) {
  const isGold = name => gold.has(name) || localGold.has(name);
  const rel = relativeShare(value, isGold);
  if (rel) {
    return rel;
  }
  const re = /var\(\s*--([a-z0-9-]+)/g;
  let m;
  const others = [];
  // The base is white, black, transparent or a NEUTRAL hex. A CHROMATIC hex is a second accent.
  let surfaceBase = false;
  BASE_LITERAL.lastIndex = 0;
  let bm;
  while ((bm = BASE_LITERAL.exec(value)) !== null) {
    const lit = bm[0];
    if (lit[0] === '#' && chromatic(expandHex(lit.slice(1)))) {
      continue;
    }
    surfaceBase = true;
    const pctAfter = value
      .slice(bm.index + lit.length)
      .match(PCT_AFTER_LITERAL);
    const pctBefore = value.slice(0, bm.index).match(PCT_BEFORE);
    const pct = pctAfter || pctBefore;
    if (pct) {
      others.push(Number(pct[1]));
    }
  }
  let hit = null;
  while ((m = re.exec(value)) !== null) {
    const name = m[1];
    const after = value.slice(m.index + m[0].length);
    const before = value.slice(0, m.index);
    const pct = after.match(PCT_AFTER) || before.match(PCT_BEFORE);
    const pctVar = after.match(/^[^,)]*\)\s*var\(/);
    if (isGold(name) && !ROLE_TOKENS.has(name)) {
      if (hit === null) {
        if (pct) {
          hit = { token: name, share: Number(pct[1]) };
        } else if (pctVar) {
          hit = { token: name, share: 'variable' };
        } else {
          hit = { token: name, share: null };
        }
      }
    } else {
      if (!isAccentToken(name, isGold, localAccent)) {
        surfaceBase = true;
      }
      if (pct) {
        others.push(Number(pct[1]));
      }
    }
  }
  if (hit === null) {
    return null;
  }
  if (hit.share === null) {
    // Gold without a percent: the remainder inside color-mix, a full colour outside it.
    if (/color-mix\(/.test(value) && others.length && surfaceBase) {
      hit.share = Math.max(0, 100 - Math.max(...others));
    } else if (/color-mix\(/.test(value) && others.length) {
      return null; // a mix of two NAMED accents, not a surface tint
    } else {
      hit.share = 100;
    }
  }
  return hit;
}

// ─── Raw colour functions ──────────────────────────────────────────────────────────────────────
// `rgba(212,168,64,.12)`, `oklch(… / .12)` and `color(srgb … / .12)` render the same wash as
// color-mix and carry neither a token nor a hex. A wash = CHROMATIC colour AND alpha <= 45%.
// White, black and grey overlays (drawer scrims) stay legal.
const RAW_COLOR =
  /\b(rgba?|hsla?|oklch|oklab|lch|lab|color)\(\s*(?!from\b)([^()]*)\)/g;

function parseAlpha(raw) {
  const t = String(raw).trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(t)) {
    return null;
  }
  return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
}

// Chroma measured perceptually (OKLCH), so near-black `rgba(28,20,12,.45)` is neutral. Brand gold
// sits at C ~0.13, state colours 0.15–0.18, neutral overlays <= 0.023: 0.04 is in the gap.
const CHROMA_FLOOR = 0.04;
// CIE Lab/LCH use another scale: one OKLab unit is about 345 CIE units.
const LAB_CHROMA_FLOOR = CHROMA_FLOOR * 345;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function oklchChroma(r, g, b) {
  return oklchChromaLinear(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}
function oklchChromaLinear(R, G, B) {
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.sqrt(A * A + Bb * Bb);
}
function hslToRgb(h, sPct, lPct) {
  const S = sPct / 100;
  const L = lPct / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = L - c / 2;
  const t = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(hp) % 6];
  return [t[0] + m, t[1] + m, t[2] + m];
}

function rawChromatic(fn, parts) {
  const num = s => {
    const t = String(s).trim();
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(t)) {
      return null;
    }
    return { v: parseFloat(t), pct: t.endsWith('%') };
  };
  if (fn === 'rgb' || fn === 'rgba') {
    const c = parts.slice(0, 3).map(num);
    if (c.length < 3 || c.some(x => x === null)) {
      return false;
    }
    const v = c.map(x => (x.pct ? x.v / 100 : x.v / 255));
    return oklchChroma(v[0], v[1], v[2]) > CHROMA_FLOOR;
  }
  if (fn === 'hsl' || fn === 'hsla') {
    const h = num(parts[0]);
    const s = num(parts[1]);
    const l = num(parts[2]);
    if (h === null || s === null || l === null) {
      return false;
    }
    const rgb = hslToRgb(h.v, s.v, l.v);
    return oklchChroma(rgb[0], rgb[1], rgb[2]) > CHROMA_FLOOR;
  }
  if (fn === 'color') {
    // The first member is the SPACE. xyz is normalised to its white point.
    const space = String(parts[0] || '')
      .trim()
      .toLowerCase();
    const c = parts.slice(1, 4).map(num);
    if (c.length < 3 || c.some(x => x === null)) {
      return false;
    }
    let v = c.map(x => (x.pct ? x.v / 100 : x.v));
    if (space.startsWith('xyz')) {
      const wp = space === 'xyz-d50' ? [0.9642, 1, 0.8249] : [0.9505, 1, 1.089];
      v = v.map((x, i) => x / wp[i]);
      return Math.max(...v) - Math.min(...v) > 0.05;
    }
    if (
      !/^(srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020)$/.test(
        space
      )
    ) {
      return false;
    }
    const chroma =
      space === 'srgb-linear'
        ? oklchChromaLinear(v[0], v[1], v[2])
        : oklchChroma(v[0], v[1], v[2]);
    return chroma > CHROMA_FLOOR;
  }
  if (fn === 'oklch') {
    const c = num(parts[1]);
    return c !== null && Math.abs(c.pct ? c.v * 0.004 : c.v) > CHROMA_FLOOR;
  }
  // Chroma is the LENGTH of (a, b); 100% of an oklab axis is 0.4.
  if (fn === 'oklab') {
    const axis = x => (x === null ? null : x.pct ? x.v * 0.004 : x.v);
    const a = axis(num(parts[1]));
    const b = axis(num(parts[2]));
    if (a === null || b === null) {
      return false;
    }
    return Math.hypot(a, b) > CHROMA_FLOOR;
  }
  // CIE percent scales: 100% of a lab axis is 125, 100% of lch C is 150.
  const labAxis = x => (x === null ? null : x.pct ? x.v * 1.25 : x.v);
  const lchChroma = x => (x === null ? null : x.pct ? x.v * 1.5 : x.v);
  if (fn === 'lch') {
    const c = lchChroma(num(parts[1]));
    return c !== null && Math.abs(c) > LAB_CHROMA_FLOOR;
  }
  if (fn === 'lab') {
    const a = labAxis(num(parts[1]));
    const b = labAxis(num(parts[2]));
    if (a === null || b === null) {
      return false;
    }
    return Math.hypot(a, b) > LAB_CHROMA_FLOOR;
  }
  return false;
}

// DECISION: R7 ("a tint that encodes STATE stays, out of scope") works on token NAMES only: it
// exempts mixes with var(--color-error|warning|success|info) via isAccentToken. A RAW value has no
// name, so `rgba(192, 57, 43, 0.10)` is reported while the equivalent
// `color-mix(..., var(--color-error) 10%, transparent)` passes. We do not close that by guessing a
// hue: the TOKEN carries the meaning and follows a palette change, a number triple does not.
export function rawColorTint(value) {
  RAW_COLOR.lastIndex = 0;
  let m;
  while ((m = RAW_COLOR.exec(value)) !== null) {
    const fn = m[1];
    const slash = m[2].split('/');
    let alpha = null;
    let parts = m[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (slash.length === 2) {
      alpha = parseAlpha(slash[1]);
      parts = slash[0]
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
    } else if (parts.length === 4) {
      alpha = parseAlpha(parts[3]);
      parts = parts.slice(0, 3);
    }
    if (alpha === null || !(alpha > 0) || alpha > 0.45) {
      continue;
    }
    if (!rawChromatic(fn, parts)) {
      continue;
    }
    return { fn: m[0], alpha };
  }
  return null;
}

/** A chromatic hex in plain or URL-encoded form (`%23d4a840` inside a data URI). */
export function hasChromaticHex(text) {
  const plain = (text.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) || []).some(
    h => chromatic(expandHex(h.slice(1)))
  );
  const encoded = (text.match(/%23([0-9a-fA-F]{6})\b/g) || []).some(h =>
    chromatic(h.slice(3))
  );
  return plain || encoded;
}
