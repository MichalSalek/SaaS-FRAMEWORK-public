// Helpers shared by the main workspace guard rules (not a rule: `_` prefix).
import path from 'node:path';

/**
 * Workspace-relative path of the linted file with forward slashes. ESLint runs with the workspace
 * as cwd (run-guards.mjs, `eslint .` from main/), and RuleTester resolves a relative `filename`
 * against the same cwd, so samples can name their place in the tree (`src/UI/x.tsx`).
 * @param {import('eslint').Rule.RuleContext} context
 */
export function relativeFile(context) {
  return path.relative(context.cwd, context.filename).replaceAll('\\', '/');
}

/** True when `rel` equals an entry or sits under an entry that ends with `/`. */
export function matchesAny(rel, entries) {
  return entries.some(entry =>
    entry.endsWith('/') ? rel.startsWith(entry) : rel === entry
  );
}

/**
 * A file-level escape: `// <marker>: <reason>` in a COMMENT (never in a string). A bare marker
 * without a reason on the same line does not count.
 * @param {import('eslint').SourceCode} sourceCode
 * @param {string} marker e.g. `app-link-allow`
 */
export function hasEscapeWithReason(sourceCode, marker) {
  const re = new RegExp(`${marker}:[ \\t]*[^\\s]`);
  return sourceCode
    .getAllComments()
    .some(comment => comment.value.split('\n').some(line => re.test(line)));
}

/** Cooked text of a string Literal or a TemplateLiteral without expressions, else null. */
export function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? '';
  }
  return null;
}
