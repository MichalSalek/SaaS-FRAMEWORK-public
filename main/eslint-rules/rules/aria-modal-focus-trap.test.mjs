// @vitest-environment node
import guard from './aria-modal-focus-trap.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const error = [{ messageId: 'handRolled' }];
const options = [{ allow: ['src/UI/primitives/AppModalShell.atom.tsx'] }];
const f = 'x.tsx';

tester.run('nf/aria-modal-focus-trap', guard.rule, {
  valid: [
    // false in every form
    { code: `const a = <div aria-modal='false' />;`, filename: f },
    { code: `const a = <div aria-modal={false} />;`, filename: f },
    { code: `const a = <div aria-modal={open ? 'false' : undefined} />;`, filename: f },
    // the shell itself
    {
      code: `const a = <div role='dialog' aria-modal='true' />;`,
      filename: '/repo/main/src/UI/primitives/AppModalShell.atom.tsx',
      options,
    },
    // documented outlier with a reason (line comment and JSX block comment)
    {
      code: `// aria-modal-focus-trap-allow: swipe drawer, trap wired by hand\nconst a = <div aria-modal={isOpen ? 'true' : undefined} />;`,
      filename: f,
    },
    {
      code: `const a = <>{/* aria-modal-focus-trap-allow: side panel with swipe-to-close */}<div aria-modal='true' /></>;`,
      filename: f,
    },
    // prose and strings never count
    { code: `// <div aria-modal='true' />\nconst a = 1;`, filename: f },
    { code: `/* aria-modal="true" */\nconst a = 1;`, filename: f },
    { code: `const s = "aria-modal='true'";`, filename: f },
    { code: 'const s = `[aria-modal="true"]`;', filename: f },
    { code: `const a = <p>aria-modal="true"</p>;`, filename: f },
  ],
  invalid: [
    // the three literal shapes the script matched
    { code: `const a = <div role='dialog' aria-modal='true' />;`, filename: f, errors: error },
    { code: `const a = <div role="dialog" aria-modal="true" />;`, filename: f, errors: error },
    { code: `const a = <div aria-modal={true} />;`, filename: f, errors: error },
    // multi-line tag
    { code: `const a = (\n  <div\n    role='dialog'\n    aria-modal='true'\n  />\n);`, filename: f, errors: error },
    // shapes the text scan missed
    { code: `const a = <div aria-modal />;`, filename: f, errors: error },
    { code: `const a = <div aria-modal={isOpen ? 'true' : undefined} />;`, filename: f, errors: error },
    { code: `const a = <div aria-modal={open} />;`, filename: f, errors: error },
    { code: `const a = <div {...{ 'aria-modal': true }} />;`, filename: f, errors: error },
    { code: `const a = createElement('div', { 'aria-modal': 'true' });`, filename: f, errors: error },
    // bare marker without a reason
    { code: `// aria-modal-focus-trap-allow:\nconst a = <div aria-modal='true' />;`, filename: f, errors: error },
    // the shell exemption does not leak to other files
    { code: `const a = <div aria-modal='true' />;`, filename: '/repo/main/src/UI/x/Other.tsx', options, errors: error },
  ],
});
