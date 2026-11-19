// Escape scope of a CSS block, shared by the block-level theme guards (tint-discipline,
// edge-stripe-discipline, no-split-bg).
//
// The retired shell guards read an escape marker from three places, and these rules keep exactly
// those places: the block BODY (any comment inside it), its HEAD (comments between the end of the
// previous block and the selector, i.e. the comment right above the rule) and the head of every
// enclosing block (@media, a nesting parent). A marker never leaks from a sibling block: the head
// stops at the previous sibling that has a body, the way the old parser's head started after the
// previous closing brace.

/** Comments in the head of `node`: preceding siblings up to the previous block. */
function headComments(node) {
  const out = [];
  let prev = node.prev();
  while (prev) {
    if (prev.type === 'comment') {
      out.push(prev.text);
    } else if (prev.nodes || node.parent?.type === 'root') {
      // A block ends the head; at the top level so does any statement (`@import …;`).
      break;
    }
    prev = prev.prev();
  }
  return out;
}

/**
 * Text of every comment that may carry an escape for `container`.
 * @param {import('postcss').Container} container
 */
export function escapeScope(container) {
  const texts = [];
  container.walkComments(comment => {
    texts.push(comment.text);
  });
  texts.push(...headComments(container));
  for (
    let parent = container.parent;
    parent && parent.type !== 'root';
    parent = parent.parent
  ) {
    texts.push(...headComments(parent));
  }
  return texts.join('\n');
}

/**
 * State of an escape marker in a scope: 'reason' (marker plus a reason on the same line),
 * 'bare' (marker without a reason: an exception nobody can verify in review) or null.
 * @param {string} scope
 * @param {string} marker e.g. 'tint-allow'
 */
export function markerState(scope, marker) {
  const name = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  if (new RegExp(`${name}:[ \\t]*\\S`).test(scope)) {
    return 'reason';
  }
  if (new RegExp(`${name}:`).test(scope)) {
    return 'bare';
  }
  return null;
}

/** Direct declarations of a container (nested blocks are checked as blocks of their own). */
export function ownDecls(container) {
  return (container.nodes ?? [])
    .filter(node => node.type === 'decl')
    .map(decl => ({
      node: decl,
      prop: decl.prop.toLowerCase(),
      value: decl.value.trim(),
    }));
}

/** Readable head of a block: the selector, or `@name params` for an at-rule. */
export function headOf(container) {
  const raw =
    container.type === 'rule'
      ? container.selector
      : `@${container.name} ${container.params}`;
  return raw.replace(/\s+/g, ' ').trim();
}

/** Every block (rule or at-rule with a body) of a root, in source order. */
export function blocksOf(root) {
  const out = [];
  root.walk(node => {
    if ((node.type === 'rule' || node.type === 'atrule') && node.nodes) {
      out.push(node);
    }
  });
  return out;
}
