// nf/no-view-transition-api — no View Transitions API and no flushSync on the nav path.
//
// Successor of the JS half of tests/audit/no-view-transition-api.sh. `startViewTransition`
// is banned in main/src, including tests. `flushSync` is banned in the navigation
// directories (layouts, application/routing, application/stores), tests excepted.
// `::view-transition` is css/no-view-transition. A comment naming the API is not a call.
import { countSite } from '../lib.mjs';
import { relativeFile } from './_guard-files.mjs';

const NAV = [
  'src/UI/layouts/',
  'src/application/routing/',
  'src/application/stores/',
];

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'The View Transitions API and flushSync in navigation code are forbidden.',
    },
    schema: [],
    messages: {
      start:
        'startViewTransition is forbidden. Transitions go through navigation.store.',
      flush: 'flushSync in navigation code is a view-transition leftover.',
    },
  },
  create(context) {
    const rel = relativeFile(context);
    const test = rel.includes('.test.');
    const inNav = NAV.some(root => rel.startsWith(root));
    const reported = new Set();
    function nameOf(node) {
      if (node.type === 'Identifier') {
        return node.name;
      }
      if (node.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
      }
      return null;
    }
    function report(node, messageId) {
      const key = `${node.range?.[0] ?? 0}:${messageId}`;
      if (reported.has(key)) {
        return;
      }
      reported.add(key);
      context.report({ node, messageId });
    }
    return {
      'Identifier, Literal'(node) {
        countSite('no-view-transition-api');
        const name = nameOf(node);
        if (name === 'startViewTransition') {
          report(node, 'start');
        }
        if (name === 'flushSync' && inNav && !test) {
          report(node, 'flush');
        }
      },
    };
  },
};

export default {
  name: 'no-view-transition-api',
  replaces: 'tests/audit/no-view-transition-api.sh',
  rule,
  blocks: [{ files: ['src/**/*.{ts,tsx}'] }],
  presence: {
    minSites: 150000,
    what: 'identifiers and literals inspected for the view-transition API',
  },
  paths: [
    'src/UI/layouts/NavigationTransitionController.composition.tsx',
    'src/application/stores/navigation.store.ts',
  ],
};
