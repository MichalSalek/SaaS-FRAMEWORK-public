// nf/lock-sql-in-lock-module — row-lock SQL (`FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`,
// `FOR KEY SHARE`) lives only in the canonical lock module, application/db/lock-rows.ts.
//
// Lock order is a global invariant (LOCK_RANK in lock-order.ts, graph in LOCK_GRAPH.md): every row
// lock goes through a lock-rows.ts primitive that reports to the runtime order checker. A
// hand-rolled lock elsewhere is invisible to it. The order is checked at runtime, not here.
// Test: tests/concurrency/lock-order.concurrency.ts (covers listed lock cycles under forced
// interleavings; not other lock pairs, and not this rule).
//
// Read: the TEXT of string, template and regex literals (joined across `${…}` holes), never
// comments. Exceptions: the lock module itself (it must carry at least `lockSqlFloor` clauses; its
// EXISTS is asserted by run-guards through `paths`); a lock MODE as typed data (a literal whose
// WHOLE value is the mode, as a `mode` property value, or anywhere in lock-order.ts; a mode glued
// to SQL fails); `lock-discipline-allow: <reason>` on the clause line or up to 15 lines above (a
// bare marker is itself a violation).
import { countSite } from '../lib.mjs';

const LOCK_RX = /\bFOR\s+(?:NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)\b/gi;
const WHOLE_MODE_RX = /^FOR\s+(?:NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)$/i;
const ALLOW_RX = /lock-discipline-allow:(.*)$/m;
const ESCAPE_WINDOW = 15;
// Separator for the `${…}` holes of a template: not whitespace, so `FOR ${x} UPDATE` is no clause.
const HOLE = '\u0000';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Row-lock SQL only in the canonical lock module (application/db/lock-rows.ts).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          lockModule: { type: 'string' },
          modeDefiner: { type: 'string' },
          lockSqlFloor: { type: 'integer', minimum: 1 },
        },
        required: ['lockModule', 'modeDefiner', 'lockSqlFloor'],
        additionalProperties: false,
      },
    ],
    messages: {
      lock: 'Row-lock SQL outside the lock module: `{{clause}}`. Take the lock through a primitive of application/db/lock-rows.ts (lockInOrder for several rows), in LOCK_RANK order; a genuinely bespoke lock needs `// lock-discipline-allow: <reason>`.',
      bareEscape:
        '`lock-discipline-allow:` without a reason: an exception nobody had to justify.',
      floor:
        'Presence floor: the lock module carries {{count}} lock clause(s), floor {{floor}}. A gutted lock module would turn this guard into a silent green.',
    },
  },
  create(context) {
    const { lockModule, modeDefiner, lockSqlFloor } = context.options[0];
    const filename = context.filename.replaceAll('\\', '/');
    const isLockModule = filename.endsWith(lockModule);
    const isModeDefiner = filename.endsWith(modeDefiner);
    const sourceCode = context.sourceCode;
    let lockModuleClauses = 0;

    // Escape comments: line numbers of justified markers; bare markers are findings.
    const escapeLines = [];
    for (const comment of sourceCode.getAllComments()) {
      const lines = comment.value.split('\n');
      lines.forEach((text, offset) => {
        const match = text.match(ALLOW_RX);
        if (!match) {
          return;
        }
        const line = comment.loc.start.line + offset;
        if (/[A-Za-z]/.test(match[1])) {
          escapeLines.push(line);
        } else if (!isLockModule) {
          context.report({ loc: { line, column: 0 }, messageId: 'bareEscape' });
        }
      });
    }
    const escaped = line =>
      escapeLines.some(l => l <= line && line - l <= ESCAPE_WINDOW);

    /** A string literal whose whole value is a lock mode, used as data. */
    function isModeAsData(node) {
      if (
        node.type !== 'Literal' ||
        typeof node.value !== 'string' ||
        !WHOLE_MODE_RX.test(node.value)
      ) {
        return false;
      }
      if (isModeDefiner) {
        return true;
      }
      let current = node;
      let parent = node.parent;
      while (
        parent &&
        (parent.type === 'TSAsExpression' ||
          parent.type === 'TSSatisfiesExpression' ||
          parent.type === 'TSLiteralType' ||
          parent.type === 'TSTypeAnnotation')
      ) {
        current = parent;
        parent = parent.parent;
      }
      const keyName = key =>
        key?.type === 'Identifier'
          ? key.name
          : key?.type === 'Literal'
            ? key.value
            : null;
      if (parent?.type === 'Property' && parent.value === current) {
        return keyName(parent.key) === 'mode';
      }
      if (parent?.type === 'TSPropertySignature') {
        // `mode: 'FOR UPDATE'` exactly (the shell scanner read `mode:` right before the quote)
        return !parent.optional && keyName(parent.key) === 'mode';
      }
      return false;
    }

    /**
     * Scans one literal. `segments` are the text pieces with their source start line and the raw
     * source text used to place a match on a line.
     */
    function scan(node, segments) {
      countSite('lock-sql-in-lock-module');
      const text = segments.map(segment => segment.cooked).join(HOLE);
      LOCK_RX.lastIndex = 0;
      let match;
      while ((match = LOCK_RX.exec(text))) {
        if (isLockModule) {
          lockModuleClauses += 1;
          continue;
        }
        if (isModeAsData(node)) {
          continue;
        }
        // place the match: the segment holding its start, then the newlines before it
        let offset = match.index;
        let segment = segments[0];
        for (const candidate of segments) {
          if (offset <= candidate.cooked.length) {
            segment = candidate;
            break;
          }
          offset -= candidate.cooked.length + HOLE.length;
        }
        const line =
          segment.line +
          (segment.cooked.slice(0, offset).match(/\n/g)?.length ?? 0);
        if (escaped(line)) {
          continue;
        }
        context.report({
          loc: { line, column: 0 },
          messageId: 'lock',
          data: { clause: match[0].replace(/\s+/g, ' ') },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          scan(node, [{ cooked: node.value, line: node.loc.start.line }]);
        } else if (node.regex) {
          scan(node, [
            { cooked: node.regex.pattern, line: node.loc.start.line },
          ]);
        }
      },
      TemplateLiteral(node) {
        scan(
          node,
          node.quasis.map(quasi => ({
            cooked: quasi.value.cooked ?? quasi.value.raw,
            line: quasi.loc.start.line,
          }))
        );
      },
      'Program:exit'(program) {
        if (isLockModule && lockModuleClauses < lockSqlFloor) {
          context.report({
            node: program,
            messageId: 'floor',
            data: {
              count: String(lockModuleClauses),
              floor: String(lockSqlFloor),
            },
          });
        }
      },
    };
  },
};

export default {
  name: 'lock-sql-in-lock-module',
  replaces: 'tests/audit/lock-discipline.sh',
  rule,
  blocks: [
    {
      // Root: all of web-1/src (the generated Prisma clients and the READONLY kernel copy are
      // global ignores of the workspace config). Unit tests assert on lock SQL text, they take no
      // locks.
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts'],
      options: {
        lockModule: 'src/application/db/lock-rows.ts',
        modeDefiner: 'src/application/db/lock-order.ts',
        lockSqlFloor: 6,
      },
    },
  ],
  presence: {
    minSites: 12000,
    what: 'string, template and regex literals in web-1/src',
  },
  paths: [
    'src/application/db/lock-rows.ts',
    'src/application/db/lock-order.ts',
  ],
};
