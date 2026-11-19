

import { countSite } from '../lib.mjs';

const RAW_METHODS = new Set(['$queryRaw', '$executeRaw']);
const ALLOW_RX = /prisma-nested-sql-allow:[ \t]*(\S?)/;

function memberName(node) {
  if (node?.type !== 'MemberExpression') {
    return null;
  }
  if (!node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  return node.property.type === 'Literal' ? String(node.property.value) : null;
}

function isPrismaMember(node, name) {
  return (
    node?.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === 'Prisma' &&
    memberName(node) === name
  );
}

/** `Prisma.Sql` as a type reference. */
function isPrismaSqlType(typeNode) {
  return (
    typeNode?.type === 'TSTypeReference' &&
    typeNode.typeName.type === 'TSQualifiedName' &&
    typeNode.typeName.left.type === 'Identifier' &&
    typeNode.typeName.left.name === 'Prisma' &&
    typeNode.typeName.right.name === 'Sql'
  );
}

/** Visits every node of a subtree (no scope analysis needed: names are matched as text). */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') {
    return;
  }
  if (visit(node) === false) {
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach(child => walk(child, visit));
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function containsLiteralFragment(node) {
  let found = false;
  walk(node, child => {
    if (found) {
      return false;
    }
    if (
      (child.type === 'TaggedTemplateExpression' &&
        isPrismaMember(child.tag, 'sql')) ||
      isPrismaMember(child, 'empty') ||
      (child.type === 'CallExpression' && isPrismaMember(child.callee, 'join'))
    ) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/** Names an expression refers to: identifiers and static member names (`opts.clause`). */
function namesIn(node) {
  const names = new Set();
  walk(node, child => {
    if (child.type === 'Identifier') {
      names.add(child.name);
    }
    return true;
  });
  return names;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No nested Prisma SQL fragment inside a tagged $queryRaw/$executeRaw template; use the argument form.',
    },
    schema: [],
    messages: {
      literal:
        '`${ {{expr}} }`: literal Prisma fragment interpolated into a TAGGED raw template. It reaches Postgres as a bind parameter (42601 → 500). Build the query with Prisma.sql and pass it as an argument: `$queryRaw(query)`.',
      variable:
        '`${ {{expr}} }`: SQL fragment variable interpolated into a TAGGED raw template. It reaches Postgres as a bind parameter (42601 → 500). Build the query with Prisma.sql and pass it as an argument: `$queryRaw(query)`.',
      bareEscape:
        '`prisma-nested-sql-allow:` without a reason: an exception nobody had to justify.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const services = sourceCode.parserServices;
    const checker = services?.program?.getTypeChecker();
    // Imported helpers have no local declaration to inspect. Typed lint can
    // still see the Sql result, including an aliased import or a union.
    const typedFragment = expression => {
      const node = services?.esTreeNodeToTSNodeMap?.get(expression);
      if (!checker || !node) return false;
      const matches = type => {
        if (type.isUnion()) return type.types.some(matches);
        const name = (type.aliasSymbol ?? type.getSymbol())?.getName();
        return (
          name === 'Sql' &&
          type.getProperty('values') !== undefined &&
          type.getProperty('strings') !== undefined &&
          type.getProperty('sql') !== undefined
        );
      };
      return matches(checker.getTypeAtLocation(node));
    };
    const fragmentNames = new Set();
    const declarations = []; // [name, init] pairs for the alias fixpoint
    const taggedSites = [];

    const escapeLines = new Set();
    for (const comment of sourceCode.getAllComments()) {
      comment.value.split('\n').forEach((text, offset) => {
        const match = text.match(ALLOW_RX);
        if (!match) {
          return;
        }
        const line = comment.loc.start.line + offset;
        if (match[1]) {
          escapeLines.add(line);
        } else {
          context.report({ loc: { line, column: 0 }, messageId: 'bareEscape' });
        }
      });
    }

    function collectAnnotated(identifier) {
      if (isPrismaSqlType(identifier.typeAnnotation?.typeAnnotation)) {
        fragmentNames.add(identifier.name);
      }
    }

    return {
      MemberExpression(node) {
        const name = memberName(node);
        if (!RAW_METHODS.has(name ?? '')) {
          return;
        }
        countSite('prisma-nested-sql');
        const parent = node.parent;
        if (parent.type === 'TaggedTemplateExpression' && parent.tag === node) {
          taggedSites.push(parent);
        }
      },
      Identifier(node) {
        if (node.typeAnnotation) {
          collectAnnotated(node);
        }
      },
      TSPropertySignature(node) {
        if (
          node.key.type === 'Identifier' &&
          isPrismaSqlType(node.typeAnnotation?.typeAnnotation)
        ) {
          fragmentNames.add(node.key.name);
        }
      },
      ':function'(fn) {
        if (fn.id && isPrismaSqlType(fn.returnType?.typeAnnotation)) {
          fragmentNames.add(fn.id.name);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init) {
          return;
        }
        const returnsFragment =
          (node.init.type === 'ArrowFunctionExpression' ||
            node.init.type === 'FunctionExpression') &&
          isPrismaSqlType(node.init.returnType?.typeAnnotation);
        if (returnsFragment || containsLiteralFragment(node.init)) {
          fragmentNames.add(node.id.name);
        } else {
          declarations.push([node.id.name, node.init]);
        }
      },
      'Program:exit'() {
        // aliases: `const a = clause` (new; the shell scanner saw only literal initialisers)
        let grew = true;
        while (grew) {
          grew = false;
          for (const [name, init] of declarations) {
            if (
              !fragmentNames.has(name) &&
              [...namesIn(init)].some(n => fragmentNames.has(n))
            ) {
              fragmentNames.add(name);
              grew = true;
            }
          }
        }
        for (const tagged of taggedSites) {
          const quasi = tagged.quasi;
          const first = quasi.loc.start.line;
          const last = quasi.loc.end.line;
          let escaped = false;
          for (let line = first - 1; line <= last; line += 1) {
            if (escapeLines.has(line)) {
              escaped = true;
            }
          }
          if (escaped) {
            continue;
          }
          for (const expression of quasi.expressions) {
            const literal = containsLiteralFragment(expression);
            const viaName =
              !literal &&
              [...namesIn(expression)].some(name => fragmentNames.has(name));
            if (!literal && !viaName && !typedFragment(expression)) {
              continue;
            }
            context.report({
              node: expression,
              messageId: literal ? 'literal' : 'variable',
              data: {
                expr: sourceCode.getText(expression).replace(/\s+/g, ' '),
              },
            });
          }
        }
      },
    };
  },
};

export default {
  name: 'prisma-nested-sql',
  replaces: 'tests/audit/prisma-nested-sql.sh',
  rule,
  blocks: [
    {
      // Root: the whole workspace (src and scripts, unit tests included, as the old scanner read
      // every .ts); generated Prisma clients are global ignores of the workspace config.
      files: ['**/*.ts'],
      ignores: ['**/*.d.ts'],
    },
  ],
  presence: { minSites: 55, what: '$queryRaw / $executeRaw accesses in web-1' },
  paths: ['src/application/db/lock-rows.ts'],
};
