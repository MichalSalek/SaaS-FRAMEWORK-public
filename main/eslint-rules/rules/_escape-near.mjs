// Escape marker in a comment on the node's line or up to `above` lines above it, for the guards
// that inherited a line-window escape from a retired shell script (shape-inline-radius).
// Returns 'reason' (marker plus a reason), 'bare' (nothing after the colon) or null.

/**
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Node} node
 * @param {string} marker
 * @param {number} above
 */
export function escapeNear(sourceCode, node, marker, above) {
  const line = node.loc.start.line;
  const escaped = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const withReason = new RegExp(`${escaped}:[ \\t]*[^\\s*/]`);
  const bare = new RegExp(`${escaped}:`);
  let state = null;
  for (const comment of sourceCode.getAllComments()) {
    if (comment.loc.end.line < line - above || comment.loc.start.line > line) {
      continue;
    }
    if (withReason.test(comment.value)) {
      return 'reason';
    }
    if (bare.test(comment.value)) {
      state = 'bare';
    }
  }
  return state;
}
