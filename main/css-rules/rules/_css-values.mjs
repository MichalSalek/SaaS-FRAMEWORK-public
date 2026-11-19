// Value helpers shared by the token guards (hex-policy, spacing-tokens, breakpoints, fluid-type,
// motion-tokens, shape-tokens, min-font-size). PostCSS already keeps comments out of a value;
// these helpers keep QUOTED STRINGS out as well, so `content: '#c13584'` or a selector-like text in
// a string never reads as a value.

/** The value with the content of every quoted string blanked (quotes kept, same length). */
export function blankStrings(value) {
  return value.replace(
    /(["'])((?:\\.|(?!\1)[^\\])*)\1/g,
    (_m, quote, body) => `${quote}${' '.repeat(body.length)}${quote}`
  );
}

/**
 * Every call of one of `names` in `value`, with its balanced argument text.
 * @param {string} value
 * @param {RegExp} name a regexp of the function name, e.g. /\b(rgba?|hsla?)\(/g (global, ends in `\(`)
 * @returns {{ name: string, args: string, index: number }[]}
 */
export function callsOf(value, name) {
  const out = [];
  const re = new RegExp(
    name.source,
    name.flags.includes('g') ? name.flags : `${name.flags}g`
  );
  let match;
  while ((match = re.exec(value)) !== null) {
    const open = match.index + match[0].length;
    let depth = 1;
    let i = open;
    while (i < value.length && depth > 0) {
      if (value[i] === '(') {
        depth++;
      } else if (value[i] === ')') {
        depth--;
      }
      i++;
    }
    out.push({
      name: match[1] ?? match[0],
      args: value.slice(open, depth === 0 ? i - 1 : i),
      index: match.index,
    });
  }
  return out;
}

/** Splits a list on top-level commas (a cubic-bezier keeps its own commas). */
export function splitTopLevel(value) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/**
 * Escape marker state in the comments on the node's line or up to `above` lines above it:
 * 'reason' (marker plus a reason), 'bare' (marker with nothing after the colon) or null.
 * The retired scripts read the marker from the raw lines of that window; PostCSS keeps comments
 * as nodes, so the window is read over comment nodes.
 * @param {import('postcss').Node} node
 * @param {string} marker
 * @param {number} above
 */
export function markerNear(node, marker, above) {
  const line = node.source?.start?.line ?? 0;
  const escaped = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const withReason = new RegExp(`${escaped}:[ \\t]*[^\\s*/]`);
  const bare = new RegExp(`${escaped}:`);
  let state = null;
  node.root().walkComments(comment => {
    const start = comment.source?.start?.line ?? -1;
    const end = comment.source?.end?.line ?? start;
    if (end < line - above || start > line) {
      return undefined;
    }
    if (withReason.test(comment.text)) {
      state = 'reason';
      return false;
    }
    if (bare.test(comment.text)) {
      state = 'bare';
    }
    return undefined;
  });
  return state;
}
