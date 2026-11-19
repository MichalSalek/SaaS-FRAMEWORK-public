

/** Top-level tokens of a value (`0 var(--sp-2) auto` → three tokens; parentheses kept whole). */
export function valueTokens(value) {
  const tokens = [];
  let depth = 0;
  let buf = '';
  for (const ch of value) {
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (/\s/.test(ch) && depth === 0) {
      if (buf) {
        tokens.push(buf);
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) {
    tokens.push(buf);
  }
  return tokens;
}

/** A zero offset: `0`, `0px`, `0%`, … (the shell scanner accepted `0` followed by a non-digit). */
export function isZero(token) {
  return /^0(?!\d)/.test(token ?? '');
}

/** Declarations whose property is `name` or ends with `-name` (custom properties included). */
export function declsNamed(decls, name) {
  return decls.filter(d => d.prop === name || d.prop.endsWith(`-${name}`));
}
