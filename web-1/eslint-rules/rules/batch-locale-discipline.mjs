// nf/batch-locale-discipline — locale lookup is not a Prisma distinct query.
//
// Successor of tests/audit/batch-locale-discipline.sh. The helper used to be the only
// `distinct: ['created_by_user_id']`. It now uses raw DISTINCT ON, because Prisma distinct
// dedupes in memory (DECISION in email-locale-batch.resolver.ts). The forbidden shape is
// banned in the email trees, including the helper, so the old query cannot return.
// Comments and strings are not a property key.
import { countSite } from '../lib.mjs';

function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'ChainExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function arrayHasUser(node) {
  const value = unwrap(node);
  if (value?.type !== 'ArrayExpression') {
    return false;
  }
  return value.elements.some(element => {
    const item = unwrap(element);
    return item?.type === 'Literal' && item.value === 'created_by_user_id';
  });
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Email locale resolution does not re-implement the Prisma distinct query.',
    },
    schema: [],
    messages: {
      inline:
        "distinct: ['created_by_user_id'] is the retired locale query. Use batchResolveLocales.",
    },
  },
  create(context) {
    return {
      Property(node) {
        countSite('batch-locale-discipline');
        const key =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? node.key.value
              : null;
        if (key === 'distinct' && arrayHasUser(node.value)) {
          context.report({ node, messageId: 'inline' });
        }
      },
    };
  },
};

export default {
  name: 'batch-locale-discipline',
  replaces: 'tests/audit/batch-locale-discipline.sh',
  rule,
  blocks: [
    {
      files: [
        'src/domain/email/**/*.ts',
        'src/application/email-handler/**/*.ts',
      ],
      ignores: ['**/*.test.ts'],
    },
  ],
  presence: {
    minSites: 2000,
    what: 'object properties inspected in the email trees',
  },
  paths: [
    'src/application/email-handler/lifecycle/email-locale-batch.resolver.ts',
  ],
};
