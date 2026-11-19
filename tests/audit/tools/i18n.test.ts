// Tests for tools/i18n.ts: temp mini trees, the ICU parser loaded from the real main workspace.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { loadIcuParser, run } from './i18n';
import { projectRoot, report, type CheckResult } from './_lib';

const REPO = projectRoot();
const deps = { loadParser: () => loadIcuParser(REPO) };
const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type Json = Record<string, unknown>;
type PerLocale<T> = { pl: T; en: T; de: T };
const same = <T>(value: T): PerLocale<T> => ({
  pl: value,
  en: value,
  de: value,
});

interface Spec {
  common?: PerLocale<Json | string>;
  events?: PerLocale<Json | string>;
  email?: PerLocale<Json | string>;
  validation?: string;
  backend?: Record<string, string>;
  cqrs?: string;
  extraFiles?: Record<string, string>;
}

const BASE_COMMON: Json = {
  validation: { a: { b: 'Pole wymagane' } },
  page: {
    title: 'Witaj {name}',
    count: '{n, plural, one {# praca} other {# prac}}',
  },
};
const BASE_EVENTS: Json = { EV_A: 'A', EV_B: 'B', EV_C: 'C' };
const BASE_EMAIL: Json = {
  subjects: { welcome: 'Hi {{name}}', works: '{{count#praca|prace|prac}}' },
  list: ['a', 'b'],
};
const APP_EVENTS = `export const APP_EVENTS = {
  COMMANDS: { G: { DO: 'DO' } },
  INFO: { G: { A: 'EV_A', B: 'EV_B', RENAMED: 'EV_C', MISSING: 'EV_MISSING', HIDDEN: 'EV_HIDDEN' } },
} as const;
`;
const CQRS = `import { APP_EVENTS } from './app-events.const';
export const eventsDisallowedForUI = Object.freeze([
  APP_EVENTS.INFO.G.HIDDEN,
] as const);
`;
const BACKEND = {
  'h.ts':
    'export const h = (res, data) => respondSuccess(res, data, APP_EVENTS.INFO.G.A);\n',
};

/** Builds a mini repo tree; every part defaults to a clean sample. */
function tree(spec: Spec = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-i18n-'));
  tmpRoots.push(root);
  const put = (rel: string, text: string): void => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  put('web-1/src/application/http/define-endpoint.ts', 'export {};');
  put('web-1/src/application/http/http.responses.utils.ts', 'export {};');
  const json = (value: Json | string): string =>
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  put(
    '.shared-kernel/domain/i18n/i18n.config.ts',
    "export const I18N_CONFIG = Object.freeze({\n  locales: ['pl', 'en', 'de'] as const,\n});\n"
  );
  put(
    '.shared-kernel/domain/i18n/validation.i18n.ts',
    spec.validation ??
      "export const V = Object.freeze({ a: { b: 'validation.a.b' } });\n"
  );
  put('.shared-kernel/domain/events/app-events.const.ts', APP_EVENTS);
  put(
    '.shared-kernel/domain/commands-and-queries/cqrs.config.ts',
    spec.cqrs ?? CQRS
  );
  for (const locale of ['pl', 'en', 'de'] as const) {
    put(
      `main/src/locales/${locale}/common.json`,
      json((spec.common ?? same(BASE_COMMON))[locale])
    );
    put(
      `main/src/locales/${locale}/events.json`,
      json((spec.events ?? same(BASE_EVENTS))[locale])
    );
    put(
      `.shared-kernel/domain/email/locales/email-i18n.${locale}.json`,
      json((spec.email ?? same(BASE_EMAIL))[locale])
    );
  }
  for (const [rel, text] of Object.entries(spec.backend ?? BACKEND)) {
    put(`web-1/src/${rel}`, text);
  }
  for (const [rel, text] of Object.entries(spec.extraFiles ?? {})) {
    put(rel, text);
  }
  return root;
}

function check(root: string, name: string): CheckResult {
  const found = run(root, deps).find(c => c.name === name);
  assert.ok(found, `check ${name} exists`);
  return found;
}

const messages = (c: CheckResult): string[] =>
  c.findings.map(f => `${f.file}:${f.line} ${f.message}`);

void describe('i18n: clean tree', () => {
  void it('has no findings and no errors in any check (floors aside)', () => {
    for (const c of run(tree(), deps)) {
      assert.deepEqual(c.findings, [], c.name);
      assert.deepEqual(c.errors, [], c.name);
    }
  });
  void it('reads the locales from I18N_CONFIG and counts sites', () => {
    const root = tree();
    assert.equal(check(root, 'i18n:locales').sites, 3);
    assert.equal(check(root, 'i18n:validation-keys').sites, 1);
    assert.equal(check(root, 'i18n:events-coverage').sites, 1);
  });
  void it('fails on the presence floor in a mini tree (report exit 1)', () => {
    assert.equal(report('i18n', run(tree(), deps)), 1);
  });
});

void describe('i18n:validation-keys', () => {
  void it('flags a validation key missing in one locale', () => {
    const en = { ...BASE_COMMON, validation: { a: {} } };
    const c = check(
      tree({ common: { ...same(BASE_COMMON), en } }),
      'i18n:validation-keys'
    );
    assert.equal(c.findings.length, 1);
    assert.match(messages(c)[0] ?? '', /en\/common\.json.*validation\.a\.b/);
  });
  void it('flags a validation key in common.json that the SSOT lacks (stricter than the shell guard)', () => {
    const extra = { ...BASE_COMMON, validation: { a: { b: 'x', c: 'y' } } };
    const c = check(tree({ common: same(extra) }), 'i18n:validation-keys');
    assert.equal(c.findings.length, 3);
    assert.match(messages(c)[0] ?? '', /validation\.a\.c.*not declared/);
  });
  void it('does not count a key named only in a line comment, a block comment', () => {
    const validation =
      "// 'validation.ghost.one'\n/* 'validation.ghost.two' */\nexport const V = Object.freeze({ a: { b: 'validation.a.b' } });\n";
    const c = check(tree({ validation }), 'i18n:validation-keys');
    assert.deepEqual(c.findings, []);
    assert.equal(c.sites, 1);
  });
  void it('counts double-quoted and template literals (the value is the key)', () => {
    const validation =
      'export const V = { a: { b: "validation.a.b", c: `validation.a.c` } };\n';
    const c = check(tree({ validation }), 'i18n:validation-keys');
    assert.equal(c.sites, 2);
    assert.equal(c.findings.length, 3);
  });
});

void describe('i18n:common-parity and common-empty', () => {
  void it('flags a key present only in pl, in en and de', () => {
    const pl = { ...BASE_COMMON, only: { pl: 'Tylko PL' } };
    const c = check(
      tree({ common: { ...same(BASE_COMMON), pl } }),
      'i18n:common-parity'
    );
    assert.equal(c.findings.length, 2);
    assert.match(
      messages(c).join('\n'),
      /en\/common\.json.*only\.pl.*present in main\/src\/locales\/pl\/common\.json:\d+/
    );
  });
  void it('flags an empty and a whitespace-only value with its line', () => {
    const de = { ...BASE_COMMON, page: { title: '   ', count: '' } };
    const c = check(
      tree({ common: { ...same(BASE_COMMON), de } }),
      'i18n:common-empty'
    );
    assert.equal(c.findings.length, 2);
    assert.ok(
      c.findings.every(f => f.file.endsWith('de/common.json') && f.line > 1)
    );
  });
  void it('fails with the file named when a JSON file does not parse (typographic quotes)', () => {
    const broken = '{ „validation”: {} }';
    const c = check(
      tree({ common: { ...same(BASE_COMMON), en: broken } }),
      'i18n:common-parity'
    );
    assert.equal(c.errors.length, 1);
    assert.match(
      c.errors[0] ?? '',
      /main\/src\/locales\/en\/common\.json is not valid JSON/
    );
  });
  void it('fails when a locale file is missing', () => {
    const root = tree();
    rmSync(path.join(root, 'main/src/locales/de/common.json'));
    assert.match(
      check(root, 'i18n:common-empty').errors[0] ?? '',
      /does not exist: main\/src\/locales\/de\/common\.json/
    );
  });
});

void describe('i18n:interpolation', () => {
  const withTitle = (pl: string, en: string, de: string): PerLocale<Json> => ({
    pl: { ...BASE_COMMON, page: { title: pl } },
    en: { ...BASE_COMMON, page: { title: en } },
    de: { ...BASE_COMMON, page: { title: de } },
  });
  void it('flags a locale that hardcodes what the others interpolate', () => {
    const c = check(
      tree({ common: withTitle('Plan {plan}', 'The Pro plan', 'Plan {plan}') }),
      'i18n:interpolation:common'
    );
    assert.equal(c.findings.length, 1);
    assert.match(messages(c)[0] ?? '', /page\.title.*en \{\}/);
  });
  void it('accepts a plural selector used only for inflection', () => {
    const c = check(
      tree({
        common: withTitle(
          '{count, plural, one {przypięta} other {przypięte}}',
          'pinned',
          'angeheftet'
        ),
      }),
      'i18n:interpolation:common'
    );
    assert.deepEqual(c.findings, []);
  });
  void it('counts # in a plural branch, a select selector and a rich tag as content', () => {
    const pound = check(
      tree({
        common: withTitle('{n, plural, other {# prac}}', 'works', 'Arbeiten'),
      }),
      'i18n:interpolation:common'
    );
    assert.equal(pound.findings.length, 1);
    const select = check(
      tree({
        common: withTitle(
          '{plan, select, PRO {Pro} other {Free}}',
          'Pro',
          'Pro'
        ),
      }),
      'i18n:interpolation:common'
    );
    assert.equal(select.findings.length, 1);
    const tag = check(
      tree({
        common: withTitle('<b>Ważne</b>', 'Important', '<b>Wichtig</b>'),
      }),
      'i18n:interpolation:common'
    );
    assert.equal(tag.findings.length, 1);
  });
  void it('flags an ICU message that does not parse', () => {
    const c = check(
      tree({ common: withTitle('Witaj {name', 'Hi {name}', 'Hallo {name}') }),
      'i18n:interpolation:common'
    );
    assert.ok(
      c.findings.some(
        f =>
          /does not parse/.test(f.message) && f.file.endsWith('pl/common.json')
      )
    );
  });
  void it('checks events.json as ICU', () => {
    const c = check(
      tree({
        events: { ...same(BASE_EVENTS), de: { ...BASE_EVENTS, EV_A: 'A {x}' } },
      }),
      'i18n:interpolation:events'
    );
    assert.equal(c.findings.length, 1);
  });
  void it('flags malformed mustache in kernel e-mails even when all locales agree', () => {
    for (const bad of ['Hi {{ name }}', 'Hi {{user.name}}', 'Hi {name}']) {
      const email = {
        ...BASE_EMAIL,
        subjects: { welcome: bad, works: '{{count#a|b}}' },
      };
      const c = check(tree({ email: same(email) }), 'i18n:interpolation:email');
      assert.equal(c.findings.length, 3, bad);
    }
  });
  void it('accepts the mustache plural form and compares only the parameter name', () => {
    const de = {
      ...BASE_EMAIL,
      subjects: {
        welcome: 'Hallo {{name}}',
        works: '{{count#Arbeit|Arbeiten}}',
      },
    };
    const c = check(
      tree({ email: { ...same(BASE_EMAIL), de } }),
      'i18n:interpolation:email'
    );
    assert.deepEqual(c.findings, []);
  });
  void it('flags a mustache parameter drift', () => {
    const en = {
      ...BASE_EMAIL,
      subjects: { welcome: 'Hi there', works: '{{count#a|b}}' },
    };
    const c = check(
      tree({ email: { ...same(BASE_EMAIL), en } }),
      'i18n:interpolation:email'
    );
    assert.equal(c.findings.length, 1);
  });
});

void describe('i18n:events-parity', () => {
  void it('flags a key missing in one locale', () => {
    const { EV_C: _drop, ...de } = BASE_EVENTS;
    void _drop;
    const c = check(
      tree({ events: { ...same(BASE_EVENTS), de } }),
      'i18n:events-parity'
    );
    assert.equal(c.findings.length, 1);
    assert.match(messages(c)[0] ?? '', /de\/events\.json.*EV_C/);
  });
  void it('sees a key that is not UPPER_SNAKE and an empty message (stricter than the shell guard)', () => {
    const pl = { ...BASE_EVENTS, lowerKey: 'x' };
    assert.equal(
      check(
        tree({ events: { ...same(BASE_EVENTS), pl } }),
        'i18n:events-parity'
      ).findings.length,
      2
    );
    const en = { ...BASE_EVENTS, EV_A: ' ' };
    assert.equal(
      check(
        tree({ events: { ...same(BASE_EVENTS), en } }),
        'i18n:events-parity'
      ).findings.length,
      1
    );
  });
});

void describe('i18n:events-coverage', () => {
  const missing = (backend: Record<string, string>): string[] =>
    messages(check(tree({ backend }), 'i18n:events-coverage'));

  void it('flags an event passed to respond*() without a translation (in every locale)', () => {
    const out = missing({
      'a.ts': 'respondBadRequest(res, APP_EVENTS.INFO.G.MISSING, null);\n',
    });
    assert.equal(out.length, 3);
    assert.match(out[0] ?? '', /EV_MISSING/);
  });
  void it('resolves the event VALUE, not the property name', () => {
    assert.deepEqual(
      missing({
        'a.ts': 'respondConflict(res, APP_EVENTS.INFO.G.RENAMED, null);\n',
      }),
      []
    );
  });
  void it('subtracts eventsDisallowedForUI', () => {
    assert.deepEqual(
      missing({
        'a.ts': 'respondInfo(res, 200, APP_EVENTS.INFO.G.HIDDEN, null);\n',
      }),
      []
    );
  });
  void it('emits the default event of a helper called without one, read from its parameter default', () => {
    const helper =
      'export const respondOops = (res, data, event = APP_EVENTS.INFO.G.MISSING) => respondInfo(res, 500, event, data);\n';
    assert.equal(
      missing({ 'h.ts': helper, 'a.ts': 'respondOops(res, null);\n' }).length,
      3
    );
    assert.deepEqual(
      missing({
        'h.ts': helper,
        'a.ts': 'respondOops(res, null, APP_EVENTS.INFO.G.A);\n',
      }),
      []
    );
  });
  void it('reads every value of a map indexed in the event argument', () => {
    const src = `const reasonMap = { a: APP_EVENTS.INFO.G.A, nested: { b: 1 }, c: APP_EVENTS.INFO.G.MISSING };
respondNotFound(res, reasonMap[reason], null);
`;
    assert.equal(missing({ 'a.ts': src }).length, 3);
  });
  void it('reads event: inside .json() and ignores eventName: audit payloads', () => {
    assert.equal(
      missing({
        'a.ts':
          'res.status(400).json({ event: APP_EVENTS.INFO.G.MISSING, data: null });\n',
      }).length,
      3
    );
    assert.deepEqual(
      missing({
        'a.ts':
          'recordAuditEvent_IO({ eventName: APP_EVENTS.INFO.G.MISSING });\n',
      }),
      []
    );
    assert.deepEqual(
      missing({
        'a.ts':
          'await db.eventLog.findMany({ where: { event: APP_EVENTS.INFO.G.MISSING } });\n',
      }),
      []
    );
  });
  void it('does not count a call in a line comment, a block comment, a string or a template literal', () => {
    const prose = [
      '// respondBadRequest(res, APP_EVENTS.INFO.G.MISSING, null);',
      '/* respondBadRequest(res, APP_EVENTS.INFO.G.MISSING, null); */',
      "const s = 'respondBadRequest(res, APP_EVENTS.INFO.G.MISSING, null)';",
      'const t = `respondBadRequest(res, APP_EVENTS.INFO.G.MISSING, null)`;',
      'const u = `${x} res.json({ event: APP_EVENTS.INFO.G.MISSING })`;',
    ].join('\n');
    assert.deepEqual(missing({ 'a.ts': `${prose}\n` }), []);
  });
  void it('is an error when a disallowed entry does not resolve', () => {
    const cqrs =
      'export const eventsDisallowedForUI = Object.freeze([APP_EVENTS.INFO.G.NOPE] as const);\n';
    const c = check(tree({ cqrs }), 'i18n:events-coverage');
    assert.match(
      c.errors[0] ?? '',
      /APP_EVENTS\.INFO\.G\.NOPE is not an APP_EVENTS\.INFO event/
    );
  });
  void it('counts a bound ok() event, including a multiline call and an import alias', () => {
    const handler = `import { defineEndpoint as bind } from '@app/http/define-endpoint';
export default bind(G_CONTRACTS.DO, {
  handle: async ({ ok }) => {
    ok(
      data,
      APP_EVENTS.INFO.G.MISSING
    );
  },
});
`;
    assert.equal(missing({ 'a.ts': handler }).length, 3);
  });
  void it('resolves successEvents when the ok() argument is not a literal', () => {
    const handler = `import { defineEndpoint } from '@app/http/define-endpoint';
export default defineEndpoint(G_CONTRACTS.DO, {
  handle: async ({ ok }) => { ok(data, picked); },
});
`;
    const contract = `export const G_CONTRACTS = defineContracts({
  DO: { successEvents: ['EV_MISSING'] },
});
`;
    const root = tree({
      backend: { 'a.ts': handler },
      extraFiles: { '.shared-kernel/domain/g/g.contracts.ts': contract },
    });
    assert.equal(check(root, 'i18n:events-coverage').findings.length, 3);
  });
  void it('ignores a fake ok: comment, string, type-only import, and a nested parameter', () => {
    const shadowed = `import { defineEndpoint } from '@app/http/define-endpoint';
// ok(data, APP_EVENTS.INFO.G.MISSING)
const s = 'ok(data, APP_EVENTS.INFO.G.MISSING)';
export default defineEndpoint(G_CONTRACTS.DO, {
  handle: async ({ ok }) => {
    const inner = (ok: (data: unknown, event: unknown) => void) => {
      ok(data, APP_EVENTS.INFO.G.MISSING);
    };
    return inner;
  },
});
`;
    const typeOnly = `import type { defineEndpoint } from '@app/http/define-endpoint';
declare function defineEndpoint(contract: object, config: object): unknown;
export default defineEndpoint(G_CONTRACTS.DO, {
  handle: async ({ ok }) => { ok(data, APP_EVENTS.INFO.G.MISSING); },
});
`;
    assert.deepEqual(
      missing({ 'shadowed.ts': shadowed, 'type-only.ts': typeOnly }),
      []
    );
  });
  void it('does not count ok() imported from a lookalike define-endpoint module', () => {
    const file = `import { defineEndpoint } from './fake-define-endpoint';
export default defineEndpoint(G_CONTRACTS.DO, {
  handle: async ({ ok }) => { ok(data, APP_EVENTS.INFO.G.MISSING); },
});
`;
    const dir = `import { defineEndpoint } from './fake/define-endpoint';
export default defineEndpoint(G_CONTRACTS.DO, {
  handle: async ({ ok }) => { ok(data, APP_EVENTS.INFO.G.MISSING); },
});
`;
    assert.deepEqual(missing({ 'a.ts': file, 'b.ts': dir }), []);
  });
  void it('skips the READONLY kernel copy and .tsx files', () => {
    const call = 'respondBadRequest(res, APP_EVENTS.INFO.G.MISSING, null);\n';
    assert.deepEqual(
      missing({
        'READONLY-shared-kernel/x.ts': call,
        'a.tsx': call,
        'b.ts': '',
      }),
      []
    );
  });
});

void describe('i18n:email-parity', () => {
  void it('flags a leaf missing in one locale and an empty leaf', () => {
    const en = {
      ...BASE_EMAIL,
      subjects: { welcome: 'Hi {{name}}' },
      list: ['a', ''],
    };
    const c = check(
      tree({ email: { ...same(BASE_EMAIL), en } }),
      'i18n:email-parity'
    );
    assert.equal(c.findings.length, 2);
    assert.match(messages(c).join('\n'), /en\.json.*subjects\.works/);
    assert.match(messages(c).join('\n'), /empty translation `list\[1\]`/);
  });
});

void describe('i18n:locales', () => {
  void it('flags a locale directory the config does not know', () => {
    const root = tree({
      extraFiles: { 'main/src/locales/fr/common.json': '{}' },
    });
    assert.match(
      messages(check(root, 'i18n:locales'))[0] ?? '',
      /locales\/fr.*not in I18N_CONFIG/
    );
  });
});

void describe('i18n: locale independence', () => {
  void it('prints the same report under LC_ALL=C and a UTF-8 locale', () => {
    const pl = { ...BASE_COMMON, zażółć: { gęślą: 'jaźń' }, Ąb: 'x', ab: 'y' };
    const root = tree({ common: { ...same(BASE_COMMON), pl } });
    const cli = (lc: string): string => {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx/esm', 'tests/audit/tools/i18n.ts'],
        {
          cwd: REPO,
          encoding: 'utf8',
          env: {
            ...process.env,
            AUDIT_ROOT_OVERRIDE: root,
            LC_ALL: lc,
            LANG: lc,
          },
        }
      );
      return `${result.status}\n${result.stdout}${result.stderr}`;
    };
    const c = cli('C');
    assert.match(c, /zażółć\.gęślą/);
    assert.equal(c, cli('C.UTF-8'));
  });
});
