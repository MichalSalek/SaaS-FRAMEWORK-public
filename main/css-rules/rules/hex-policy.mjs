

import { blankStrings, callsOf } from './_css-values.mjs';

const ALLOWLIST = {
  // #000 in @media print: black-on-white paper, deliberately outside the mode-aware tokens.
  'src/UI/features/static/LegalDocLayout.module.css': 'print black',
  // #c13584 = Instagram's official brand colour on the IG affordance (recognisability).
  'src/UI/features/explore/components/ExploreStylistsTab.module.css':
    'Instagram brand colour',
  // #000 as a darken anchor in color-mix (… var(--color-primary) 88%, #000 12%), documented inline.
  'src/UI/features/static/HelpCenterPage.module.css': 'darken anchor',
};

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const NAMED =
  /^(white|black|red|blue|green|yellow|orange|purple|pink|gray|grey|silver|gold)$/i;
const RAW_FN = /\b(oklch|rgba?|hsla?)\(/g;
const URL_HEX = /%23([0-9a-fA-F]{3,8})\b/g;
const STRUCTURAL = new Set([
  'fff',
  'ffff',
  'ffffff',
  'ffffffff',
  '000',
  '0000',
  '000000',
  '000000ff',
]);
const COLOUR_SITE =
  /#[0-9a-fA-F]{3,8}\b|\b(oklch|rgba?|hsla?|color-mix)\(|var\(--color-|%23/;

/** A brand (non-neutral) hex URL-encoded inside a data URI. */
function brandHexInDataUri(raw) {
  const decoded = raw.replace(/%25/g, '%');
  if (!/url\(/i.test(decoded)) {
    return null;
  }
  URL_HEX.lastIndex = 0;
  let match;
  while ((match = URL_HEX.exec(decoded)) !== null) {
    const open = decoded.lastIndexOf('url(', match.index);
    if (open === -1 || !/data:/i.test(decoded.slice(open, match.index))) {
      continue;
    }
    if (!STRUCTURAL.has(match[1].toLowerCase())) {
      return match[1];
    }
  }
  return null;
}

/** Shape of the first raw colour in a declaration value, or null. */
export function rawColourOf(rawValue) {
  const value = blankStrings(rawValue);
  const hex = value.match(HEX);
  if (hex) {
    return `raw hex ${hex[0]}`;
  }
  for (const call of callsOf(value, RAW_FN)) {
    if (!call.args.includes('var(')) {
      return `raw ${call.name}()`;
    }
  }
  if (NAMED.test(value.trim())) {
    return `CSS colour name "${value.trim()}"`;
  }
  const brand = brandHexInDataUri(rawValue);
  if (brand) {
    return `brand hex %23${brand} in a data URI`;
  }
  return null;
}

export default {
  name: 'hex-policy',
  replaces: 'tests/audit/hex-policy.sh',
  files: ['src/**/*.css'],
  ignores: [],
  paths: Object.keys(ALLOWLIST),
  presence: {
    minSites: 2500,
    what: 'colour declarations (hex, colour functions, color-mix, var(--color-*))',
  },
  setup(ctx) {
    ctx.seenAllow = new Set();
    ctx.liveAllow = new Set();
  },
  check(root, ctx) {
    const allowed = ctx.file in ALLOWLIST;
    if (allowed) {
      ctx.seenAllow.add(ctx.file);
    }
    root.walkDecls(decl => {
      if (decl.prop.startsWith('--')) {
        return;
      }
      if (COLOUR_SITE.test(decl.value)) {
        ctx.site();
      }
      const shape = rawColourOf(decl.value);
      if (!shape) {
        return;
      }
      if (allowed) {
        ctx.liveAllow.add(ctx.file);
        return;
      }
      ctx.report(
        decl,
        `${shape} in "${decl.prop}"; use a role token var(--color-*) or a named local custom property`
      );
    });
  },
  finish(ctx) {
    for (const rel of ctx.seenAllow) {
      if (!ctx.liveAllow.has(rel)) {
        ctx.error(
          `allowlist entry ${rel} holds no raw colour any more: remove it from the allowlist`
        );
      }
    }
  },
};
