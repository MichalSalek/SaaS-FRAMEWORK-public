// @vitest-environment node
import guard from './raw-timestamp-interpolation.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const ts = createRuleTester();
const tsx = createRuleTester({ jsx: true });
const raw = [{ messageId: 'raw' }];
const decl = `declare function t(key: string, values?: Record<string, unknown>): string;
declare function formatDate(iso: string, locale?: string): string;
declare const stylist: { paired_at: string };
declare const locale: string;
`;

ts.run('nf/raw-timestamp-interpolation', guard.rule, {
  valid: [
    // fixture must-pass/multiline-formatted.tsx
    `${decl}export function pairedLabel(): string {
  return t('pairedAt', {
    date: formatDate(stylist.paired_at, locale),
  });
}`,
    // fixture must-pass/escape-with-reason.tsx
    `${decl}declare const audit: { exported_at: string };
export function auditStamp(): string {
  return t('exportedAt', {
    date: audit.exported_at, // raw-timestamp-allow: machine-readable audit stamp, not user copy
  });
}`,
    `${decl}t('x', { date: /* raw-timestamp-allow: export stamp */ stylist.paired_at });`,
    // a formatter anywhere in the value
    `${decl}t('x', { date: keepWhole(formatDate(stylist.paired_at, locale)) });`,
    `${decl}t('x', { date: new Date(stylist.paired_at).toLocaleDateString() });`,
    `${decl}const formatted = formatDate(stylist.paired_at); t('x', { date: formatted });`,
    // not a wire timestamp / not a translator
    `${decl}t('x', { date: stylist.paired_on, count: 3 });`,
    `${decl}const row = { date: stylist.paired_at }; push({ date: stylist.paired_at });`,
    // prose and strings never count
    `${decl}// t('x', { date: stylist.paired_at })\nconst a = 1;`,
    `${decl}/* t('x', { date: stylist.paired_at }) */\nconst a = 1;`,
    `${decl}const s = "t('x', { date: stylist.paired_at })";`,
    `${decl}const s = \`t('x', { date: stylist.paired_at })\`;`,
    `${decl}t('x', { date: 'stylist.paired_at' });`,
  ],
  invalid: [
    // fixture must-fail/multiline-raw-at.tsx
    {
      code: `${decl}export function pairedLabel(): string {
  return t('pairedAt', {
    date: stylist.paired_at,
  });
}`,
      errors: raw,
    },
    // fixture must-fail/singleline-raw-at.tsx
    {
      code: `${decl}declare const record: { created_at: string };
export const label = (): string => t('createdAt', { date: record.created_at });`,
      errors: raw,
    },
    // bare escape marker without a reason
    { code: `${decl}t('x', { date: stylist.paired_at, // raw-timestamp-allow:\n});`, errors: raw },
    // shapes the text scan could not see
    { code: `${decl}t('x', { date: stylist?.paired_at });`, errors: raw },
    { code: `${decl}t('x', { date: stylist.paired_at ?? '' });`, errors: raw },
    { code: `${decl}t('x', { date: ok ? stylist.paired_at : '' });`, errors: raw },
    { code: `${decl}t('x', { date: \`\${stylist.paired_at}\` });`, errors: raw },
    { code: `${decl}t('x', { date: stylist['paired_at'] });`, errors: raw },
    { code: `${decl}t('x', { date: stylist.paired_at as string });`, errors: raw },
    { code: `${decl}t('x', { when: stylist.paired_at });`, errors: raw },
    { code: `${decl}const { paired_at } = stylist; t('x', { paired_at });`, errors: raw },
    { code: `${decl}const d = stylist.paired_at; t('x', { date: d });`, errors: raw },
    // other translators: any `t*`, a useTranslations result under any name, .rich, .t
    { code: `${decl}tLabels('x', { date: stylist.paired_at });`, errors: raw },
    {
      code: `${decl}const s = useTranslations('a'); s('x', { date: stylist.paired_at });`,
      errors: raw,
    },
    {
      code: `${decl}async function f() { const g = await getTranslations('a'); return g('x', { date: stylist.paired_at }); }`,
      errors: raw,
    },
    { code: `${decl}t.rich('x', { date: stylist.paired_at });`, errors: raw },
    { code: `${decl}props.t('x', { date: stylist.paired_at });`, errors: raw },
  ],
});

tsx.run('nf/raw-timestamp-interpolation (tsx)', guard.rule, {
  valid: [
    { code: `const a = <p>{t('x', { date: formatDate(r.created_at, locale) })}</p>;`, filename: 'x.tsx' },
    { code: `const a = <p>t('x', {'{'} date: r.created_at {'}'})</p>;`, filename: 'x.tsx' },
  ],
  invalid: [
    { code: `const a = <p>{t('x', { date: r.created_at })}</p>;`, filename: 'x.tsx', errors: raw },
  ],
});
