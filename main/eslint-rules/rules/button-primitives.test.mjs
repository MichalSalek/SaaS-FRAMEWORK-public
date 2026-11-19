// @vitest-environment node
import guard from './button-primitives.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const error = [{ messageId: 'raw' }];
const f = 'x.tsx';
const allowOptions = [{ allow: ['src/UI/features/salon-staff/StaffMemberCard.organism.tsx'] }];

tester.run('nf/button-primitives', guard.rule, {
  valid: [
    // the design-system component with a layout class (CookieBanner shape)
    { code: `const a = <Button variant='ghost' className={styles.actionBtn} icon={<X />} />;`, filename: f },
    // raw button with an unrelated class, and the close family (out of scope on purpose)
    { code: `const a = <button className={styles.trigger}>Go</button>;`, filename: f },
    { code: `const a = <button className={styles.closeButton}><XIcon /></button>;`, filename: f },
    { code: `const a = <button className={styles.dismissBtn}><XIcon /></button>;`, filename: f },
    // tokens that only resemble the family
    { code: `const a = <button className={styles.actions}>a</button>;`, filename: f },
    { code: `const a = <button className={styles.iconMedallion}>a</button>;`, filename: f },
    // a family class on a non-button element
    { code: `const a = <div className={styles.iconButton} />;`, filename: f },
    // allowlisted file
    {
      code: `const a = <button className={styles.iconButton}><X /></button>;`,
      filename: '/repo/main/src/UI/features/salon-staff/StaffMemberCard.organism.tsx',
      options: allowOptions,
    },
    // prose and strings outside className never count
    { code: `// <button className={styles.iconBtn}>\nconst a = 1;`, filename: f },
    { code: `/* <button className={styles.iconBtn}> */\nconst a = 1;`, filename: f },
    { code: `const s = '<button className={styles.iconBtn}>';`, filename: f },
    { code: 'const s = `<button className={styles.iconBtn}>`;', filename: f },
    { code: `const a = <button title='iconBtn' className={styles.row}>x</button>;`, filename: f },
  ],
  invalid: [
    // the script's families, on a single- and a multi-line tag
    { code: `const a = <button className={styles.iconButton}><X /></button>;`, filename: f, errors: error },
    { code: `const a = <button className={styles.actionBtn}>a</button>;`, filename: f, errors: error },
    {
      code: `const a = (\n  <button\n    type='button'\n    onClick={() => go()}\n    className={styles.cardActionBtn}\n  >\n    <X />\n  </button>\n);`,
      filename: f,
      errors: error,
    },
    // stylesheet alias and camelCase compounds
    { code: `const a = <button className={pageStyles.iconBtn}><X /></button>;`, filename: f, errors: error },
    { code: `const a = <button className={styles.rowIconButton}><X /></button>;`, filename: f, errors: error },
    { code: `const a = <button className={styles.primaryActionButton}>a</button>;`, filename: f, errors: error },
    // shapes the text scan could not see
    { code: `const a = <button className={classNames.iconBtn}><X /></button>;`, filename: f, errors: error },
    { code: `const a = <button className={styles['iconBtn']}><X /></button>;`, filename: f, errors: error },
    { code: `const a = <button className={clsx(styles.base, on && styles.iconBtn)}><X /></button>;`, filename: f, errors: error },
    { code: `const a = <button className={clsx({ [styles.iconBtn]: on })}><X /></button>;`, filename: f, errors: error },
    { code: 'const a = <button className={`${styles.iconBtn} press-feedback`}><X /></button>;', filename: f, errors: error },
    { code: `const a = <button className='iconBtn'><X /></button>;`, filename: f, errors: error },
    { code: `const cls = styles.iconBtn;\nconst a = <button className={cls}><X /></button>;`, filename: f, errors: error },
    { code: `const a = <button className={on ? styles.actionBtn : styles.row}>a</button>;`, filename: f, errors: error },
  ],
});
