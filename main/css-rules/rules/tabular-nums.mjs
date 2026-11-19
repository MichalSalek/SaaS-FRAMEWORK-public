

const ANCHOR = 'src/UI/styles/global.css';
const MARKER = /tnum-allow:[ \t]*[^\s*/]/;
const TABULAR = /(?<![\w-])tabular-nums(?![\w-])/;
const TNUM = /(["'])tnum\1/;

const stripStrings = value => value.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');

/** True when the node sets tabular figures (read on the raw value, comments excluded). */
export function setsTabular(text) {
  return TABULAR.test(stripStrings(text)) || TNUM.test(text);
}

function allowed(node, rawText) {
  if (MARKER.test(rawText)) {
    return true;
  }
  const first = node.source?.start?.line ?? 0;
  const last = node.source?.end?.line ?? first;
  let found = false;
  node.root().walkComments(comment => {
    const start = comment.source?.start?.line ?? -1;
    const end = comment.source?.end?.line ?? start;
    if (end >= first - 2 && start <= last && MARKER.test(comment.text)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

export default {
  name: 'tabular-nums',
  replaces: 'tests/audit/tabular-nums.sh (stylesheets)',
  files: ['src/**/*.css'],
  ignores: [],
  paths: [ANCHOR],
  presence: {
    minSites: 5,
    what: 'font-variant-numeric / font-feature-settings declarations under src (measured 7)',
  },
  setup(ctx) {
    if (ctx.exists(ANCHOR) && !ctx.read(ANCHOR).includes('tnum-allow')) {
      ctx.error(
        `${ANCHOR} no longer documents the tnum-allow rule (DECISION comment gone)`
      );
    }
  },
  check(root, ctx) {
    const inspect = (node, value, raw) => {
      if (!setsTabular(value)) {
        return;
      }
      if (!allowed(node, raw)) {
        ctx.report(
          node,
          'tabular figures without a tnum-allow reason: the feature widens . , : ; and is inherited'
        );
      }
    };
    root.walkDecls(decl => {
      const prop = decl.prop.toLowerCase();
      if (prop === 'font-variant-numeric' || prop === 'font-feature-settings') {
        ctx.site();
      }
      inspect(
        decl,
        decl.value,
        `${decl.raws.between ?? ''} ${decl.raws.value?.raw ?? ''}`
      );
    });
    root.walkAtRules(atRule =>
      inspect(atRule, atRule.params, atRule.raws.params?.raw ?? '')
    );
  },
};
