// nf/no-body-cast — the request body is typed in ONE place, the central validation seam.
//
// Successor of tests/audit/no-body-cast.sh. The grep matched only the literal
// text `req.body as`, so `const b = req.body; b as X`, `(req.body ?? {}) as X` and
// `const { body } = req; body as X` passed. This rule follows the value instead of the text:
// an expression is the RAW body when it is `<req|request>.body` (any member form), a logical or
// conditional over it, or an identifier whose initialiser or assignment is one (aliases chained).
// Reported: a type assertion (`as T`, `<T>x`, `as unknown as T`) on the raw body, and a typed
// declaration `const x: T = <raw body>` (an `any` re-asserted by annotation). `unknown` is allowed:
// it asserts nothing, and it is how the seam itself (request.middleware.ts) receives the body.
import { countSite, staticPropertyName } from '../lib.mjs';

const REQUEST_NAMES = /^(req|request)$/;

function isUnknownType(typeNode) {
  return typeNode?.type === 'TSUnknownKeyword';
}

/** Members of an object type that assert nothing: every property is optional-or-not `unknown`. */
function membersAssertNothing(members) {
  return members.every(
    member =>
      member.type === 'TSPropertySignature' &&
      isUnknownType(member.typeAnnotation?.typeAnnotation)
  );
}

function strip(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSNonNullExpression' ||
      current.type === 'ChainExpression' ||
      current.type === 'TSSatisfiesExpression')
  ) {
    current = current.expression;
  }
  return current;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No type assertion on the raw request body; the body is typed once, after validation, in the handler pipeline.',
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      cast: 'Raw request body re-typed with `{{form}}`: read the validated `body` from defineHandler instead (the cast asserts a type no validator checked).',
    },
  },
  create(context) {
    const allow = context.options[0]?.allow ?? [];
    const filename = context.filename.replaceAll('\\', '/');
    if (allow.some(fragment => filename.endsWith(fragment))) {
      return {};
    }
    const sourceCode = context.sourceCode;

    function variableOf(identifier) {
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

    /** @returns {boolean} */
    function isRawBody(node, seen = new Set()) {
      const value = strip(node);
      if (!value) {
        return false;
      }
      if (value.type === 'TSAsExpression' || value.type === 'TSTypeAssertion') {
        // `(req.body as unknown) as T`: the inner cast to unknown keeps the value raw.
        return (
          isUnknownType(value.typeAnnotation) &&
          isRawBody(value.expression, seen)
        );
      }
      if (value.type === 'MemberExpression') {
        const object = strip(value.object);
        if (staticPropertyName(value) !== 'body' || !object) {
          return false;
        }
        if (object.type === 'Identifier') {
          return (
            REQUEST_NAMES.test(object.name) || isRequestAlias(object, seen)
          );
        }
        // `ctx.req.body`, `this.request.body`: a request reached through a property.
        return (
          object.type === 'MemberExpression' &&
          REQUEST_NAMES.test(staticPropertyName(object) ?? '')
        );
      }
      if (value.type === 'LogicalExpression') {
        return isRawBody(value.left, seen) || isRawBody(value.right, seen);
      }
      if (value.type === 'ConditionalExpression') {
        return (
          isRawBody(value.consequent, seen) || isRawBody(value.alternate, seen)
        );
      }
      if (value.type === 'Identifier') {
        return identifierHolds(
          value,
          seen,
          init => isRawBody(init, seen),
          true
        );
      }
      return false;
    }

    /** `const r = req` → r.body is the raw body too. */
    function isRequestAlias(identifier, seen) {
      return identifierHolds(
        identifier,
        seen,
        init => {
          const value = strip(init);
          return (
            value?.type === 'Identifier' &&
            (REQUEST_NAMES.test(value.name) || isRequestAlias(value, seen))
          );
        },
        false
      );
    }

    /**
     * True when the identifier is bound to a value `test` accepts: its declarator initialiser,
     * any later assignment, or — with `destructure` — `const { body } = req` / `{ body: b }`.
     */
    function identifierHolds(identifier, seen, test, destructure) {
      const variable = variableOf(identifier);
      if (!variable || seen.has(variable)) {
        return false;
      }
      seen.add(variable);
      for (const def of variable.defs) {
        if (def.type !== 'Variable') {
          continue;
        }
        const declarator = def.node;
        if (
          declarator.id.type === 'Identifier' &&
          declarator.init &&
          test(declarator.init)
        ) {
          return true;
        }
        if (
          destructure &&
          declarator.id.type === 'ObjectPattern' &&
          declarator.init
        ) {
          const property = def.name.parent;
          if (property?.type === 'Property') {
            const key =
              property.key.type === 'Identifier'
                ? property.key.name
                : property.key.value;
            const source = strip(declarator.init);
            if (
              key === 'body' &&
              source?.type === 'Identifier' &&
              (REQUEST_NAMES.test(source.name) || isRequestAlias(source, seen))
            ) {
              return true;
            }
          }
        }
      }
      for (const reference of variable.references) {
        if (
          reference.isWrite() &&
          !reference.init &&
          reference.writeExpr &&
          test(reference.writeExpr)
        ) {
          return true;
        }
      }
      return false;
    }

    /**
     * A target type that asserts nothing about the value: `unknown`, an object type whose every
     * property is `unknown`, or a same-file interface/type alias of that shape. A raw handler
     * (withPublicHandler / withRawSecretHandler) may read its body that way and narrow each field
     * with `typeof`; anything stronger is the unchecked re-typing this rule exists for.
     */
    function assertsNothing(typeNode) {
      if (isUnknownType(typeNode)) {
        return true;
      }
      if (typeNode?.type === 'TSTypeLiteral') {
        return membersAssertNothing(typeNode.members);
      }
      if (
        typeNode?.type === 'TSTypeReference' &&
        typeNode.typeName.type === 'Identifier' &&
        !typeNode.typeArguments
      ) {
        const variable = variableOf(typeNode.typeName);
        const def = variable?.defs.find(d => d.type === 'Type');
        const decl = def?.node;
        if (decl?.type === 'TSInterfaceDeclaration') {
          return (
            (decl.extends ?? []).length === 0 &&
            membersAssertNothing(decl.body.body)
          );
        }
        if (decl?.type === 'TSTypeAliasDeclaration') {
          return assertsNothing(decl.typeAnnotation);
        }
      }
      return false;
    }

    function checkCast(node) {
      countSite('no-body-cast');
      if (assertsNothing(node.typeAnnotation)) {
        return;
      }
      if (isRawBody(node.expression)) {
        context.report({ node, messageId: 'cast', data: { form: 'as' } });
      }
    }

    return {
      TSAsExpression: checkCast,
      TSTypeAssertion: checkCast,
      VariableDeclarator(node) {
        const annotation = node.id.typeAnnotation?.typeAnnotation;
        if (!annotation || !node.init) {
          return;
        }
        countSite('no-body-cast');
        if (!assertsNothing(annotation) && isRawBody(node.init)) {
          context.report({ node, messageId: 'cast', data: { form: ': T =' } });
        }
      },
    };
  },
};

export default {
  name: 'no-body-cast',
  replaces: 'tests/audit/no-body-cast.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.ts'],
      ignores: ['src/READONLY-shared-kernel/**', '**/*.test.ts'],
      options: {
        allow: [],
      },
    },
  ],
  presence: {
    minSites: 50,
    what: 'type assertions and typed declarations in web-1/src',
  },
  paths: [],
};
