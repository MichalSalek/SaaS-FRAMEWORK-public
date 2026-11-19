// Scope helpers shared by the web-1 guard rules (not a rule: `_` prefix).

/**
 * The variable an identifier refers to, walking up from the scope it sits in; null for an
 * undeclared (global) name.
 * @param {import('eslint').SourceCode} sourceCode
 * @param {any} identifier
 */
export function variableOf(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const found = scope.set.get(identifier.name);
    if (found && found.defs.length > 0) {
      return found;
    }
    scope = scope.upper;
  }
  return null;
}

/** Text of a string literal or of a template literal without expressions, else null. */
export function staticString(node) {
  if (!node) {
    return null;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

/** Key name of an object Property / pattern property with a static key, else null. */
export function propertyKeyName(property) {
  if (property.type !== 'Property') {
    return null;
  }
  if (!property.computed && property.key.type === 'Identifier') {
    return property.key.name;
  }
  return staticString(property.key);
}

/** Forward-slash filename (ESLint gives native separators). */
export function slashed(filename) {
  return filename.replaceAll('\\', '/');
}

/**
 * `allow` option entries are workspace-relative paths; a file matches when its path ends with
 * `/<entry>` (or equals it).
 */
export function isAllowedFile(filename, allow) {
  const file = slashed(filename);
  return allow.some(entry => file === entry || file.endsWith(`/${entry}`));
}
