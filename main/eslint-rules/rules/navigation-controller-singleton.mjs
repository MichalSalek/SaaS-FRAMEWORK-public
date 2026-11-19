// nf/navigation-controller-singleton — one subscriber to router navigation events.
//
// Successor of tests/audit/navigation-controller-singleton.sh. Only
// NavigationTransitionController may name routeChangeStart/Complete/Error or call
// beforePopState. Tests are out (they drive a mock). A comment that names the event
// is not a subscription.
import { countSite } from '../lib.mjs';
import { relativeFile } from './_guard-files.mjs';

const OWNER = 'src/UI/layouts/NavigationTransitionController.composition.tsx';
const EVENTS = new Set([
  'routeChangeStart',
  'routeChangeComplete',
  'routeChangeError',
]);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Only NavigationTransitionController subscribes to router navigation events.',
    },
    schema: [],
    messages: {
      subscriber:
        'Router event `{{what}}` outside NavigationTransitionController.',
    },
  },
  create(context) {
    const rel = relativeFile(context);
    if (rel.includes('.test.')) {
      return {};
    }
    const owner = rel === OWNER;
    function seen(node, what) {
      if (owner) {
        countSite('navigation-controller-singleton');
        return;
      }
      context.report({ node, messageId: 'subscriber', data: { what } });
    }
    return {
      Identifier(node) {
        if (EVENTS.has(node.name)) {
          seen(node, node.name);
        }
      },
      Literal(node) {
        if (typeof node.value === 'string' && EVENTS.has(node.value)) {
          seen(node, node.value);
        }
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === 'Identifier' &&
          node.property.name === 'beforePopState'
        ) {
          seen(node, 'beforePopState');
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'beforePopState'
        ) {
          seen(node, 'beforePopState');
        }
      },
    };
  },
};

export default {
  name: 'navigation-controller-singleton',
  replaces: 'tests/audit/navigation-controller-singleton.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['**/*.test.ts', '**/*.test.tsx'],
    },
  ],
  presence: {
    minSites: 6,
    what: 'routeChange* and beforePopState sites in NavigationTransitionController (measured 8)',
  },
  paths: [OWNER],
};
