// nf/prisma-error-narrowing — Prisma errors are narrowed STRUCTURALLY, never by class identity.
//
// Under Turbopack the generated client is realised more than once, so
// `error instanceof Prisma.PrismaClientKnown…` is FALSE for a real Prisma error and the graceful
// P2002/P2025 branch falls through to an unmapped 500. The SSOT detectors are in
// src/application/db/prisma-error.ts (isP2002, isP2025, isPrismaErrorCode, …) and
// serialization-conflict.ts.
//   1. No `instanceof` whose right side is a Prisma class. The right side is resolved, so
//      `import { Prisma as P }` + `instanceof P.X`, `const { PrismaClientKnownRequestError: E } =
//      Prisma` + `instanceof E`, a class imported from the client or `@prisma/client/runtime/*`,
//      a namespace import and any `PrismaClient…Error` are seen.
//   2. No bare P2025 comparison (`code === 'P2025'`): use isP2025(). `==`, `!==`, `!=`, either
//      operand order and `case 'P2025':` count too.
// Escape: `prisma-error-narrowing-allow: <reason>` on the line or within the three lines above (a
// marker without a reason escapes nothing).
import { countSite, unwrapTs } from '../lib.mjs';
import { isPrismaClientModule } from './_prisma.mjs';
import { propertyKeyName, staticString, variableOf } from './_scope.mjs';

const NAME = 'prisma-error-narrowing';
const MARKER = 'prisma-error-narrowing-allow:';
const PRISMA_ERROR_CLASS = /^Prisma\w*Error$/;
const EQUALITY = new Set(['===', '==', '!==', '!=']);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No `instanceof` on Prisma classes and no bare P2025 compare: use the structural detectors in @app/db/prisma-error.',
    },
    schema: [],
    messages: {
      instanceof:
        '`instanceof {{what}}` is FALSE under Turbopack (duplicated class identity): use isPrismaErrorCode / isP2002 / isP2025 / isP2003 / isDeadlock from @app/db/prisma-error.',
      p2025:
        'Bare P2025 compare: use isP2025(error) from @app/db/prisma-error.',
      bareMarker:
        '`prisma-error-narrowing-allow:` needs a reason after the colon; a bare marker escapes nothing.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const comments = sourceCode.getAllComments();

    /** 'ok' (escaped with a reason), 'bare' (marker without reason) or null. */
    function escapeState(node) {
      const line = node.loc.start.line;
      let state = null;
      for (const comment of comments) {
        if (comment.loc.end.line < line - 3 || comment.loc.start.line > line) {
          continue;
        }
        const at = comment.value.indexOf(MARKER);
        if (at === -1) {
          continue;
        }
        const reason = comment.value
          .slice(at + MARKER.length)
          .replace(/\*\/\s*$/, '')
          .trim();
        if (reason.length > 0) {
          return 'ok';
        }
        state = 'bare';
      }
      return state;
    }

    function report(node, messageId, data) {
      const state = escapeState(node);
      if (state === 'ok') {
        return;
      }
      context.report({
        node,
        messageId: state === 'bare' ? 'bareMarker' : messageId,
        data,
      });
    }

    /** Import binding of `identifier`, as { source, imported } ('*' for a namespace import). */
    function importOf(identifier) {
      const variable = variableOf(sourceCode, identifier);
      const def = variable?.defs.find(d => d.type === 'ImportBinding');
      if (!def) {
        return null;
      }
      const source = def.parent.source.value;
      const spec = def.node;
      if (spec.type === 'ImportNamespaceSpecifier') {
        return { source, imported: '*' };
      }
      if (spec.type === 'ImportDefaultSpecifier') {
        return { source, imported: 'default' };
      }
      const imported =
        spec.imported.type === 'Identifier'
          ? spec.imported.name
          : spec.imported.value;
      return { source, imported };
    }

    /** Initialiser of a const-like identifier binding (`const x = …`), else null. */
    function initOf(identifier) {
      const variable = variableOf(sourceCode, identifier);
      const def = variable?.defs.find(d => d.type === 'Variable');
      if (!def || !def.node.init) {
        return null;
      }
      return { declarator: def.node, name: def.name };
    }

    /** The Prisma namespace (or the client module object that carries it). */
    function isPrismaNamespace(node, seen = new Set()) {
      const value = unwrapTs(node);
      if (!value) {
        return false;
      }
      if (value.type === 'MemberExpression') {
        const property = value.computed
          ? staticString(value.property)
          : value.property.name;
        return property === 'Prisma';
      }
      if (value.type !== 'Identifier' || seen.has(value.name)) {
        return false;
      }
      seen.add(value.name);
      const imported = importOf(value);
      if (imported) {
        return (
          isPrismaClientModule(imported.source) &&
          (imported.imported === 'Prisma' ||
            imported.imported === '*' ||
            imported.imported === 'default')
        );
      }
      const bound = initOf(value);
      if (bound) {
        if (bound.declarator.id.type === 'Identifier') {
          return isPrismaNamespace(bound.declarator.init, seen);
        }
        // `const { Prisma: P } = client`
        const property =
          bound.name.parent?.type === 'Property' ? bound.name.parent : null;
        return property !== null && propertyKeyName(property) === 'Prisma';
      }
      // An undeclared `Prisma` (global / ambient) is the namespace by name, as the grep read it.
      return value.name === 'Prisma' && variableOf(sourceCode, value) === null;
    }

    /** Right side of `instanceof` that is a Prisma class; returns a label or null. */
    function prismaClass(node, seen = new Set()) {
      const value = unwrapTs(node);
      if (!value) {
        return null;
      }
      if (value.type === 'MemberExpression') {
        const property = value.computed
          ? staticString(value.property)
          : value.property.name;
        if (isPrismaNamespace(value.object)) {
          return `Prisma.${property ?? '[…]'}`;
        }
        return property && PRISMA_ERROR_CLASS.test(property) ? property : null;
      }
      if (value.type !== 'Identifier' || seen.has(value.name)) {
        return null;
      }
      seen.add(value.name);
      const imported = importOf(value);
      if (imported) {
        if (
          isPrismaClientModule(imported.source) ||
          PRISMA_ERROR_CLASS.test(imported.imported)
        ) {
          return imported.imported;
        }
        return null;
      }
      const bound = initOf(value);
      if (bound) {
        const { declarator, name } = bound;
        if (declarator.id.type === 'Identifier') {
          return prismaClass(declarator.init, seen);
        }
        // `const { PrismaClientKnownRequestError: E } = Prisma`
        const property = name.parent?.type === 'Property' ? name.parent : null;
        if (property && isPrismaNamespace(declarator.init)) {
          return `Prisma.${propertyKeyName(property) ?? '[…]'}`;
        }
        if (
          property &&
          PRISMA_ERROR_CLASS.test(propertyKeyName(property) ?? '')
        ) {
          return propertyKeyName(property);
        }
        return null;
      }
      // An undeclared `PrismaClient…Error` (ambient global) is a Prisma class by name; a local
      // class of that name is somebody's own sentinel and is not.
      return PRISMA_ERROR_CLASS.test(value.name) &&
        variableOf(sourceCode, value) === null
        ? value.name
        : null;
    }

    function isP2025(node) {
      return staticString(unwrapTs(node)) === 'P2025';
    }

    return {
      BinaryExpression(node) {
        if (node.operator === 'instanceof') {
          countSite(NAME);
          const what = prismaClass(node.right);
          if (what) {
            report(node, 'instanceof', { what });
          }
          return;
        }
        if (EQUALITY.has(node.operator)) {
          countSite(NAME);
          if (isP2025(node.left) || isP2025(node.right)) {
            report(node, 'p2025');
          }
        }
      },
      SwitchCase(node) {
        if (node.test && isP2025(node.test)) {
          report(node.test, 'p2025');
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/prisma-error-narrowing.sh',
  rule,
  blocks: [
    {
      // Root: all of web-1/src (the grep read only domain/ and application/). The generated
      // clients and the vendored kernel are global ignores of the workspace config.
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['**/*.d.ts'],
    },
  ],
  presence: {
    minSites: 2000,
    what: '`instanceof` expressions and equality comparisons in web-1/src',
  },
  paths: ['src/application/db/prisma-error.ts'],
};
