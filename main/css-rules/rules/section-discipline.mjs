// css/section-discipline — no hand-rolled full-bleed breakout outside page and hero shells.
//
// Successor of tests/audit/section-discipline.sh. `<Section>` owns
// `margin-left: calc(50% - 50vw)`. Scope is feature module CSS, not playground, shared,
// components or layouts. A block is legal when its selector is `.page` / `.hero…`, or a
// `section-discipline-allow: <reason>` comment sits in the block or an ancestor. The shell
// accepted a bare marker; this rule does not (no bare marker in the tree).
import { escapeScope, headOf, markerState } from './_scope.mjs';

const BREAKOUT = /calc\(\s*50%\s*-\s*50vw\s*\)|calc\(\s*-50vw\s*\+\s*50%\s*\)/;
const SHELL = /(^|,)\s*\.(page|hero)/;

function outOfScope(file) {
  return /(^|\/)(shared|playground)\//.test(file);
}

function allowState(block) {
  const chunks = [escapeScope(block)];
  for (
    let parent = block.parent;
    parent && parent.type !== 'root';
    parent = parent.parent
  ) {
    parent.walkComments(comment => {
      chunks.push(comment.text);
    });
  }
  return markerState(chunks.join('\n'), 'section-discipline-allow');
}

export default {
  name: 'section-discipline',
  replaces: 'tests/audit/section-discipline.sh',
  files: ['src/UI/features/**/*.module.css'],
  ignores: ['src/UI/features/**/playground/**', 'src/UI/features/**/shared/**'],
  paths: ['src/UI/components/Section/Section.module.css'],
  presence: {
    minSites: 10000,
    what: 'declarations inspected in feature modules',
  },
  check(root, ctx) {
    if (outOfScope(ctx.file)) {
      return;
    }
    root.walkDecls(decl => {
      ctx.site();
      if (!BREAKOUT.test(decl.value)) {
        return;
      }
      let block = decl.parent;
      while (block && block.type !== 'rule') {
        block = block.parent;
      }
      const selector = (block?.selector ?? '').replace(/\s+/g, ' ').trim();
      if (SHELL.test(selector)) {
        return;
      }
      const marker = allowState(block ?? decl.parent);
      if (marker === 'reason') {
        return;
      }
      const label = block ? headOf(block) : '?';
      ctx.report(
        decl,
        marker === 'bare'
          ? `[${label}] section-discipline-allow without a reason`
          : `[${label}] manual breakout outside .page/.hero`
      );
    });
  },
};
