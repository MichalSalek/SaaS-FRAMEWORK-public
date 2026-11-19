// nf/navigation-transition-ssot — transition state has one owner.
//
// Successor of tests/audit/navigation-transition-ssot.sh. Relics of the old nav-direction
// store are banned everywhere. `html.dataset.nav*` and `setAttribute('data-nav-…')` are
// written only by NavigationTransitionController. Tests may stub the writes. CSS may read
// [data-nav-*]. A comment is not a write.
import { countSite, staticPropertyName, unwrapTs } from '../lib.mjs';
import { relativeFile, staticString } from './_guard-files.mjs';

const OWNER = 'src/UI/layouts/NavigationTransitionController.composition.tsx';
const RELICS = new Set([
  'lastHookNavTs',
  'openPopstateTransition',
  'useNavDirectionStore',
]);
const WRITE_KEYS = new Set(['navDirection', 'navPhase', 'navPolicy']);

function isDataset(node) {
  const current = unwrapTs(node);
  if (!current) {
    return false;
  }
  if (current.type === 'Identifier') {
    return current.name === 'dataset';
  }
  return staticPropertyName(current) === 'dataset';
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Navigation transition state lives in navigation.store and one DOM writer.',
    },
    schema: [],
    messages: {
      relic:
        'Relic of the old nav-direction store (`{{what}}`). State lives in navigation.store.',
      write: 'Write of {{what}} outside NavigationTransitionController.',
    },
  },
  create(context) {
    const rel = relativeFile(context);
    const test = rel.includes('.test.');
    const owner = rel === OWNER;
    function relic(node, what) {
      context.report({ node, messageId: 'relic', data: { what } });
    }
    function write(node, what) {
      if (owner) {
        countSite('navigation-transition-ssot');
        return;
      }
      if (test) {
        return;
      }
      context.report({ node, messageId: 'write', data: { what } });
    }
    return {
      Identifier(node) {
        if (RELICS.has(node.name)) {
          relic(node, node.name);
        }
      },
      Literal(node) {
        if (
          typeof node.value === 'string' &&
          node.value.includes('navDirection.store')
        ) {
          relic(node, 'navDirection.store');
        }
      },
      MemberExpression(node) {
        const prop = staticPropertyName(node);
        if (
          prop === 'store' &&
          node.object.type === 'Identifier' &&
          node.object.name === 'navDirection'
        ) {
          relic(node, 'navDirection.store');
        }
        if (prop && WRITE_KEYS.has(prop) && isDataset(node.object)) {
          write(node, prop);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : staticPropertyName(callee);
        if (name !== 'setAttribute') {
          return;
        }
        const arg = staticString(unwrapTs(node.arguments[0]));
        if (arg?.startsWith('data-nav-')) {
          write(node, arg);
        }
      },
    };
  },
};

export default {
  name: 'navigation-transition-ssot',
  replaces: 'tests/audit/navigation-transition-ssot.sh',
  rule,
  blocks: [{ files: ['src/**/*.{ts,tsx}'] }],
  presence: {
    minSites: 4,
    what: 'dataset nav* writes in NavigationTransitionController (measured 6)',
  },
  paths: [OWNER, 'src/application/stores/navigation.store.ts'],
};
