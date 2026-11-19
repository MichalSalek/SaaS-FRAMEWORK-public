// css/no-view-transition — no `::view-transition` pseudo-elements.
//
// Successor of the CSS half of tests/audit/no-view-transition-api.sh. The view-transition
// API animated the whole document, including fixed chrome. Transitions go through
// navigation.store and NavigationTransitionController. JS (`startViewTransition`,
// `flushSync`) is nf/no-view-transition-api.
export default {
  name: 'no-view-transition',
  replaces: 'tests/audit/no-view-transition-api.sh',
  files: ['src/**/*.css'],
  ignores: [],
  paths: ['src/UI/layouts/navigation-transition.module.css'],
  presence: {
    minSites: 3500,
    what: 'style rules inspected for ::view-transition',
  },
  check(root, ctx) {
    root.walkRules(rule => {
      ctx.site();
      if (rule.selector.includes('::view-transition')) {
        ctx.report(
          rule,
          '::view-transition is forbidden; the navigation FSM owns the transition'
        );
      }
    });
  },
};
