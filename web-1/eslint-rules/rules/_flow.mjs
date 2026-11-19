// Shared data-flow helpers for the `nf/*` rules that follow a VALUE instead of a spelling (a
// helper module, not a rule: `index.mjs` skips `rules/_*.mjs`).
//
// The grep guards these rules replace matched a text shape (`...body`, `body.account_id`), so an
// alias (`const b = req.body; b.account_id`), a rename (`({ body: input })`) or a destructuring
// step passed. The helpers here resolve an identifier to the expressions it was bound to (its
// declarator initialiser, later assignments, the object it was destructured from) so a rule can
// ask "does this expression carry the request body?" whatever the spelling.
import { staticPropertyName } from '../lib.mjs';

/** Strips TS-only wrappers and parentheses-equivalents that keep the runtime value. */
export function strip(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'ChainExpression' ||
      current.type === 'AwaitExpression')
  ) {
    current = current.expression ?? current.argument;
  }
  return current;
}

/** Scope variable an identifier refers to, or null (a global or an unresolved name). */
export function variableOf(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const found = scope.set.get(identifier.name);
    if (found) {
      return found;
    }
    scope = scope.upper;
  }
  return null;
}

/** Key of a pattern/object Property (`a`, `'a'`, `[`a`]`), or null for a computed one. */
export function propertyKey(property) {
  if (property.type !== 'Property') {
    return null;
  }
  if (!property.computed && property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (
    property.key.type === 'Literal' &&
    typeof property.key.value === 'string'
  ) {
    return property.key.value;
  }
  if (
    property.key.type === 'TemplateLiteral' &&
    property.key.expressions.length === 0
  ) {
    return property.key.quasis[0].value.cooked;
  }
  return null;
}

/**
 * Where a binding identifier sits inside a destructuring pattern: the chain of property keys
 * from the pattern root down to it (`const { a: { b } } = x` → b has ['a', 'b']), and the
 * pattern root. Returns null when the identifier is not inside a pattern.
 */
export function patternPath(bindingIdentifier) {
  const keys = [];
  let node = bindingIdentifier;
  let parent = node.parent;
  let inPattern = false;
  while (parent) {
    if (parent.type === 'AssignmentPattern' && parent.left === node) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (
      parent.type === 'Property' &&
      parent.value === node &&
      parent.parent?.type === 'ObjectPattern'
    ) {
      const key = propertyKey(parent);
      keys.unshift(key);
      node = parent.parent;
      parent = node.parent;
      inPattern = true;
      continue;
    }
    if (parent.type === 'RestElement' && parent.argument === node) {
      keys.unshift('...');
      node = parent.parent;
      parent = node.parent;
      inPattern = true;
      continue;
    }
    if (parent.type === 'ArrayPattern') {
      keys.unshift('[]');
      node = parent;
      parent = node.parent;
      inPattern = true;
      continue;
    }
    break;
  }
  return inPattern ? { keys, root: node } : null;
}

const WRAPPER_POSITIONAL_BODY = new Set([
  'defineHandler',
  'HTTPRequestHandlerMiddleware',
]);
const WRAPPER_INPUT_KEY = new Set(['defineEndpoint']);
const HANDLER_PROPERTIES = new Set(['handle', 'businessLogic']);

/** Name of the call a handler function is configured in: `defineHandler({ handle: fn })`. */
function wrapperOfHandlerFunction(fn) {
  const property = fn.parent;
  if (property?.type !== 'Property' || property.value !== fn) {
    return null;
  }
  if (!HANDLER_PROPERTIES.has(propertyKey(property) ?? '')) {
    return null;
  }
  const object = property.parent;
  const call = object?.parent;
  if (object?.type !== 'ObjectExpression' || call?.type !== 'CallExpression') {
    return null;
  }
  const callee = strip(call.callee);
  return callee?.type === 'Identifier' ? callee.name : null;
}

/**
 * What the first parameter of a handler function receives: 'body' for `defineHandler` /
 * `HTTPRequestHandlerMiddleware` (`handle(body, ctx)`), 'ctx' for `defineEndpoint`
 * (`handle({ input, ctx })`, key `input` is the body), 'none' otherwise.
 */
export function paramRootState(fn, paramRoot) {
  const isFirst =
    fn.params[0] === paramRoot || fn.params[0]?.left === paramRoot;
  const wrapper = isFirst ? wrapperOfHandlerFunction(fn) : null;
  if (wrapper && WRAPPER_POSITIONAL_BODY.has(wrapper)) {
    return 'body';
  }
  if (wrapper && WRAPPER_INPUT_KEY.has(wrapper)) {
    return 'ctx';
  }
  return 'none';
}

/** One destructuring step: the state of a sub-pattern under `key`. */
export function stepState(state, key) {
  if (state === 'body' || state === 'derived') {
    return 'derived';
  }
  if (key === 'body' || (state === 'ctx' && key === 'input')) {
    return 'body';
  }
  return 'none';
}

/** Names that hold the request body when nothing better is known (a plain parameter). */
export const BODY_NAME = /^(_*body|requestBody|rawBody)$/;

/**
 * A DECLARED binding named like the body (`body`, `bodyRest`, `requestBody`, `rawBody`) counts as
 * body-derived whatever its initialiser: the retired grep matched these names as text, so a body
 * rebuilt through an unknown helper (`const body = await readJson(req)`) must not go dark.
 */
/**
 * Helpers that return ONLY the keys listed at the call site (an explicit field pick, which is what
 * the IDOR message asks for): their result is not the body. `redactAuditPayload` copies the allowed
 * keys of an audit payload (application/event-log/event-log-io.wrapper.ts).
 */
export const FIELD_PICKERS = new Set(['redactAuditPayload']);

export const DECLARED_BODY_NAME = /^(_*body[A-Za-z0-9_]*|requestBody|rawBody)$/;

/**
 * Builds the request-body data flow for one file.
 *
 * `isBody(node)`: the expression IS the request body (or a logical/conditional choice that may
 *   yield it). Sources: any `<x>.body` member, a binding destructured from key `body`, the first
 *   parameter of a `handle` / `businessLogic` function configured in `defineHandler` or
 *   `HTTPRequestHandlerMiddleware`, the `input` destructured from the `defineEndpoint` handle
 *   parameter, an unresolved parameter named like a body, and any alias of those.
 * `isBodyDerived(node)`: the body itself or any part of it (`body.props`, `const { a } = body`).
 */
export function createBodyFlow(sourceCode) {
  /** Walks the destructuring keys from a pattern root whose own state is known. */
  function walkKeys(rootState, keys) {
    return keys.reduce(stepState, rootState);
  }

  function bindingIs(identifier, seen, wanted) {
    const variable = variableOf(sourceCode, identifier);
    if (!variable) {
      return BODY_NAME.test(identifier.name);
    }
    if (seen.has(variable)) {
      return false;
    }
    seen.add(variable);
    const accept = state =>
      state === 'body' || (wanted === 'derived' && state === 'derived');
    for (const def of variable.defs) {
      const path = patternPath(def.name);
      if (def.type === 'Parameter') {
        const fn = def.node;
        const root = path ? path.root : def.name;
        let rootState = paramRootState(fn, root);
        if (rootState === 'none' && !path && BODY_NAME.test(def.name.name)) {
          rootState = 'body';
        }
        if (accept(path ? walkKeys(rootState, path.keys) : rootState)) {
          return true;
        }
        continue;
      }
      if (def.type !== 'Variable') {
        continue;
      }
      const init = def.node.init;
      if (!path) {
        if (init && check(init, seen, wanted)) {
          return true;
        }
        if (wanted === 'derived' && DECLARED_BODY_NAME.test(def.name.name)) {
          return true;
        }
        continue;
      }
      let rootState = 'none';
      if (init && check(init, new Set(seen), 'body')) {
        rootState = 'body';
      } else if (init && check(init, new Set(seen), 'derived')) {
        rootState = 'derived';
      }
      if (accept(walkKeys(rootState, path.keys))) {
        return true;
      }
    }
    for (const reference of variable.references) {
      const write = reference.writeExpr;
      if (
        reference.isWrite() &&
        !reference.init &&
        write &&
        write.parent?.type === 'AssignmentExpression' &&
        write.parent.left === reference.identifier &&
        check(write, seen, wanted)
      ) {
        return true;
      }
    }
    return false;
  }

  /** @param {'body'|'derived'} wanted */
  function check(node, seen, wanted) {
    const value = strip(node);
    if (!value) {
      return false;
    }
    switch (value.type) {
      case 'LogicalExpression':
        // `a && b` yields b or a falsy a (nothing to spread or read), `a || b` / `a ?? b` either.
        return value.operator === '&&'
          ? check(value.right, seen, wanted)
          : check(value.left, seen, wanted) || check(value.right, seen, wanted);
      case 'ConditionalExpression':
        return (
          check(value.consequent, seen, wanted) ||
          check(value.alternate, seen, wanted)
        );
      case 'MemberExpression':
        if (staticPropertyName(value) === 'body') {
          return true;
        }
        return wanted === 'derived' && check(value.object, seen, 'derived');
      case 'Identifier':
        return bindingIs(value, seen, wanted);
      case 'AwaitExpression':
        return check(value.argument, seen, wanted);
      // A value computed FROM the body is derived from it: `schema.parse(req.body)`,
      // `JSON.parse(String(req.body))`, `omit(req.body, 'id')`, `req.body.trim()`, and a copy
      // `{ ...req.body }`. Without this, a parse or a copy laundered the body past both rules.
      case 'CallExpression':
      case 'NewExpression':
        if (wanted !== 'derived') {
          return false;
        }
        if (value.callee.type === 'Identifier' && FIELD_PICKERS.has(value.callee.name)) {
          return false;
        }
        if (
          value.callee.type === 'MemberExpression' &&
          check(value.callee.object, seen, 'derived')
        ) {
          return true;
        }
        return value.arguments.some(argument =>
          check(argument.type === 'SpreadElement' ? argument.argument : argument, seen, 'derived')
        );
      case 'ObjectExpression':
        return (
          wanted === 'derived' &&
          value.properties.some(
            property => property.type === 'SpreadElement' && check(property.argument, seen, 'derived')
          )
        );
      case 'TemplateLiteral':
        return wanted === 'derived' && value.expressions.some(e => check(e, seen, 'derived'));
      default:
        return false;
    }
  }

  return {
    isBody: node => check(node, new Set(), 'body'),
    isBodyDerived: node => check(node, new Set(), 'derived'),
  };
}
