// Shared helpers for the local guard rules (`nf/*`). Plain ESM, no build step: ESLint loads these
// files straight from `eslint.config.mjs`. Each workspace (main, web-1, root) is built and linted on
// its own, so it carries its own copy of this infrastructure and imports nothing from outside
// itself; `lib.mjs`, `index.mjs` and `run-guards.mjs` must stay byte-identical across the three
// copies (asserted by tests/audit/lint-guards.sh).

/**
 * Counts one candidate site the rule inspected (not a finding). `run-guards.mjs` compares the
 * total with the rule's `presence.minSites`: a guard whose anchor was renamed away reads zero sites
 * and fails loudly instead of reporting a green run over nothing.
 * @param {string} ruleName
 */
export function countSite(ruleName) {
  const sites = (globalThis.__NF_GUARD_SITES ??= new Map());
  sites.set(ruleName, (sites.get(ruleName) ?? 0) + 1);
}

/** Reads the site counters collected in this process (used by run-guards.mjs). */
export function readSites() {
  return globalThis.__NF_GUARD_SITES ?? new Map();
}

/** Resets the counters (run-guards.mjs, before a measured run). */
export function resetSites() {
  globalThis.__NF_GUARD_SITES = new Map();
}

/**
 * Strips TS-only wrappers that do not change the runtime value: `x!`, `(x)`, `x satisfies T`,
 * `<T>x` and `x as T`. Used by rules that must see through a cast to the expression underneath.
 * @param {import('estree').Node} node
 */
export function unwrapTs(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'ChainExpression')
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Name of a static member access (`a.b`, `a['b']`, `a[`b`]`), or null for a computed one.
 * @param {any} member MemberExpression
 */
export function staticPropertyName(member) {
  if (member.type !== 'MemberExpression') {
    return null;
  }
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  if (member.property.type === 'Literal' && typeof member.property.value === 'string') {
    return member.property.value;
  }
  if (
    member.property.type === 'TemplateLiteral' &&
    member.property.expressions.length === 0
  ) {
    return member.property.quasis[0].value.cooked;
  }
  return null;
}
