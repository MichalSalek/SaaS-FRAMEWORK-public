// Mutation proofs for d5-cross. Existing shell fixtures are copied into mini
// trees; a string that only looks like a waiver must not silence a real hit.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  checkAssetPaths,
  checkCpNesting,
  checkDecisionFormat,
  checkDocsSsot,
  checkEventReaderWriter,
  checkLegacyConsole,
  checkLegacyTodo,
  checkPagesRouteFiles,
  checkSuppressGlobalError,
  checkSweepInterceptor,
} from './d5-cross';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-d5x-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries({
    'web-1/src/application/http/define-endpoint.ts': 'export {};',
    ...files,
  })) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

function copySample(sample: string, target: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-d5x-'));
  tmpRoots.push(root);
  const place = (name: string, abs: string): void => {
    const rel = name.includes('%')
      ? name.split('%').join('/')
      : path.posix.join(target, name);
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(abs));
  };
  if (statSync(sample).isDirectory()) {
    for (const name of readdirSync(sample)) {
      const abs = path.join(sample, name);
      if (statSync(abs).isFile()) {
        place(name, abs);
      }
    }
    return root;
  }
  place(path.basename(sample), sample);
  return root;
}

const messages = (check: CheckResult): string[] =>
  check.findings.map(finding => finding.message);

function samples(dir: string): string[] {
  return readdirSync(dir).filter(
    name =>
      name !== '_target.txt' &&
      !name.endsWith('.expect') &&
      !name.endsWith('.expect-not')
  );
}

const FIX = 'tests/audit/_fixtures';
const MUT = `${FIX}/d5-cross-mutations`;

function targetOf(audit: string): string {
  return readFileSync(`${FIX}/${audit}/_target.txt`, 'utf8').trim();
}

void describe('existing shell fixtures', () => {
  void it('keeps decision-format must-fail red and must-pass green', () => {
    const target = targetOf('decision-format');
    for (const name of samples(`${FIX}/decision-format/must-fail`)) {
      const found = messages(
        checkDecisionFormat(
          copySample(`${FIX}/decision-format/must-fail/${name}`, target)
        )
      );
      assert.ok(found.length > 0, `${name} should fail`);
    }
    for (const name of samples(`${FIX}/decision-format/must-pass`)) {
      const check = checkDecisionFormat(
        copySample(`${FIX}/decision-format/must-pass/${name}`, target)
      );
      assert.deepEqual(messages(check), [], name);
      assert.deepEqual(check.errors, [], name);
    }
  });

  void it('keeps pages-route, sweep, and event-reader fixtures', () => {
    const pages = targetOf('pages-route-files');
    for (const name of samples(`${FIX}/pages-route-files/must-fail`)) {
      const found = messages(
        checkPagesRouteFiles(
          copySample(`${FIX}/pages-route-files/must-fail/${name}`, pages)
        )
      );
      assert.ok(found.length > 0, name);
    }
    for (const name of samples(`${FIX}/pages-route-files/must-pass`)) {
      const check = checkPagesRouteFiles(
        copySample(`${FIX}/pages-route-files/must-pass/${name}`, pages)
      );
      assert.deepEqual(messages(check), [], name);
      assert.deepEqual(check.errors, [], name);
    }
    const sweep = targetOf('sweep-interceptor');
    for (const name of samples(`${FIX}/sweep-interceptor/must-fail`)) {
      const found = messages(
        checkSweepInterceptor(
          copySample(`${FIX}/sweep-interceptor/must-fail/${name}`, sweep)
        )
      );
      assert.ok(found.length > 0, name);
    }
    for (const name of samples(`${FIX}/sweep-interceptor/must-pass`)) {
      const check = checkSweepInterceptor(
        copySample(`${FIX}/sweep-interceptor/must-pass/${name}`, sweep)
      );
      assert.deepEqual(messages(check), [], name);
      assert.deepEqual(check.errors, [], name);
    }
    const events = targetOf('event-reader-writer');
    for (const name of samples(`${FIX}/event-reader-writer/must-fail`)) {
      const found = messages(
        checkEventReaderWriter(
          copySample(`${FIX}/event-reader-writer/must-fail/${name}`, events)
        )
      );
      assert.ok(found.length > 0, name);
    }
    for (const name of samples(`${FIX}/event-reader-writer/must-pass`)) {
      const check = checkEventReaderWriter(
        copySample(`${FIX}/event-reader-writer/must-pass/${name}`, events)
      );
      assert.deepEqual(messages(check), [], name);
      assert.deepEqual(check.errors, [], name);
    }
  });
});

void describe('d5-cross mutations', () => {
  void it('decision-format ignores a string waiver and a bare marker', () => {
    const load = (name: string): CheckResult =>
      checkDecisionFormat(
        copySample(`${MUT}/decision-format/${name}.ts`, 'main/src')
      );
    assert.ok(
      messages(load('string-waiver')).some(message =>
        message.includes('old DECISION')
      )
    );
    assert.ok(
      messages(load('bare-marker')).some(message =>
        message.includes('without a reason')
      )
    );
    assert.deepEqual(messages(load('reason')), []);
    assert.ok(
      messages(load('real-violation')).some(message =>
        message.includes('old DECISION')
      )
    );
  });

  void it('pages-route reads extensions from the AST and ignores a string marker', () => {
    const load = (name: string): CheckResult =>
      checkPagesRouteFiles(copySample(`${MUT}/pages-route/${name}`, ''));
    assert.ok(
      messages(load('string-waiver')).some(message =>
        message.includes('underscore')
      )
    );
    assert.ok(
      messages(load('bare-marker')).some(message =>
        message.includes('without a reason')
      )
    );
    assert.deepEqual(messages(load('reason')), []);
    assert.ok(
      messages(load('real-violation')).some(message =>
        message.includes('underscore')
      )
    );
  });

  void it('cp flags a real invocation and not an echo or a function definition', () => {
    const load = (name: string): CheckResult =>
      checkCpNesting(copySample(`${MUT}/cp/${name}`, ''));
    assert.ok(
      messages(load('string-echo')).some(message =>
        message.includes('recursive cp')
      )
    );
    assert.ok(
      messages(load('bare-marker')).some(message =>
        message.includes('without a reason')
      )
    );
    assert.deepEqual(messages(load('reason')), []);
    assert.ok(
      messages(load('real-violation')).some(message =>
        message.includes('recursive cp')
      )
    );
    const quiet = tree({
      'scripts/ok.sh':
        "#!/bin/sh\ncp -r dir/. dst\nprintf '%s' 'cp -r dir dst'\ncp() { echo defined; }\n",
    });
    assert.deepEqual(messages(checkCpNesting(quiet)), []);
  });

  void it('asset paths treat a string outside the registry as a hit', () => {
    const load = (name: string): CheckResult =>
      checkAssetPaths(copySample(`${MUT}/asset-paths/${name}`, ''));
    const stringHit = messages(load('string-waiver'));
    assert.ok(stringHit.some(message => message.includes('raw /img/lp/')));
    assert.ok(!stringHit.some(message => message.includes('ghost')));
    assert.ok(
      messages(load('bare-marker')).some(message =>
        message.includes('without a reason')
      )
    );
    const reason = messages(load('reason'));
    assert.deepEqual(reason, []);
    assert.ok(
      messages(load('real-violation')).some(message =>
        message.includes('raw /img/lp/')
      )
    );
  });

  void it('suppressGlobalError uses calls, not a string that names the flag', () => {
    const load = (name: string): CheckResult =>
      checkSuppressGlobalError(
        copySample(`${MUT}/suppress-global-error/${name}.ts`, 'main/src/UI')
      );
    assert.ok(
      messages(load('string-waiver')).some(message =>
        message.includes('suppressGlobalError')
      )
    );
    assert.ok(
      messages(load('bare-marker')).some(message =>
        message.includes('without a reason')
      )
    );
    assert.deepEqual(messages(load('reason')), []);
    assert.ok(
      messages(load('real-violation')).some(message =>
        message.includes('suppressGlobalError')
      )
    );
    const prose = tree({
      'main/src/UI/prose.ts':
        'export const label = "useMutation onError pushNewSnackbar suppressGlobalError: true";\n',
    });
    assert.deepEqual(messages(checkSuppressGlobalError(prose)), []);
  });

  void it('keeps the TODO ratchet and ignores console text that is not a call', () => {
    const todos = (count: number, extra = ''): string =>
      `${Array.from({ length: count }, (_, index) => `// TODO item ${index}`).join('\n')}\nexport const x = 1;\n${extra}`;
    assert.equal(
      messages(checkLegacyTodo(tree({ 'main/src/a.ts': todos(1) }))).length,
      0
    );
    assert.ok(
      messages(checkLegacyTodo(tree({ 'main/src/a.ts': todos(8) }))).length > 0
    );
    assert.equal(
      messages(
        checkLegacyTodo(
          tree({
            'main/src/a.ts':
              'const s = "TODO FIXME";\n// see docs/PLANS_TODO/plan.md\nexport const x = 1;\n',
          })
        )
      ).length,
      0
    );
    const oneCall = 'export const go = (): void => { console.log(1); };\n';
    assert.equal(
      messages(checkLegacyConsole(tree({ 'main/src/a.ts': oneCall }))).length,
      0
    );
    const noisy = `export function go(): void {\n${Array.from({ length: 22 }, () => '  console.error(1);').join('\n')}\n}\n`;
    assert.ok(
      messages(checkLegacyConsole(tree({ 'main/src/a.ts': noisy }))).length > 0
    );
    const textOnly = tree({
      'main/src/a.ts':
        'export const note = "console.log(1)";\n// console.error(1)\nexport const x = 1;\n',
    });
    const consoleCheck = checkLegacyConsole(textOnly);
    assert.equal(consoleCheck.sites, 0);
    assert.deepEqual(messages(consoleCheck), []);
  });

  void it('does not treat a string as an event-log waiver or a write', () => {
    const dead = tree({
      'web-1/src/read.ts': `
        const lie = "event-reader-writer-allow: not a comment";
        declare const DB_CLIENT: { use: { eventLog: { findMany: (a: unknown) => Promise<unknown> } } };
        export const read = () =>
          DB_CLIENT.use.eventLog.findMany({ where: { event: 'DEAD_ONLY' } });
        const mentioned = 'NEVER_WRITTEN_STRING';
      `,
    });
    const found = messages(checkEventReaderWriter(dead));
    assert.ok(found.some(message => message.includes('DEAD_ONLY')));
    assert.ok(!found.some(message => message.includes('bez powodu')));
    const alive = tree({
      'web-1/src/read.ts': `
        const lie = "event-reader-writer-allow:";
        declare const DB_CLIENT: { use: { eventLog: { findFirst: (a: unknown) => Promise<unknown> } } };
        declare const recordAuditEvent_IO: (a: unknown) => Promise<unknown>;
        declare const APP_EVENTS: { INFO: { EMAIL: { EMAIL_WELCOME_SENT: 'EMAIL_WELCOME_SENT' } } };
        export const write = () => recordAuditEvent_IO({ eventName: APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT });
        export const read = () => DB_CLIENT.use.eventLog.findFirst({ where: { event: APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT } });
      `,
    });
    assert.deepEqual(messages(checkEventReaderWriter(alive)), []);
  });

  void it('counts endpoint scope audit calls and ignores declarations', () => {
    const events = `
      declare const APP_EVENTS: { INFO: { PAIRING: { PAIRING_SESSION_ISSUED: 'PAIRING_SESSION_ISSUED' } } };
      declare const DB_CLIENT: { use: { eventLog: { count: (a: unknown) => Promise<number> } } };
    `;
    const reader = `${events}
      export const read = () => DB_CLIENT.use.eventLog.count({
        where: { event: APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED },
      });
    `;
    const omitted = tree({
      'web-1/src/read.ts': reader,
      'web-1/src/issue.ts': `${events}
        import { defineEndpoint } from '@app/http/define-endpoint';
        declare const CONTRACT: object;
        export default defineEndpoint(CONTRACT, {
          handle: async ({ ok, created }) => {
            ok({}, APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED);
            created({}, APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED);
          },
        });
      `,
    });
    const red = checkEventReaderWriter(omitted);
    assert.equal(red.minSites, 1);
    assert.ok(red.sites >= red.minSites);
    assert.deepEqual(red.errors, []);
    assert.ok(
      messages(red).some(message => message.includes('PAIRING_SESSION_ISSUED'))
    );
    const bound = tree({
      'web-1/src/read.ts': reader,
      'web-1/src/issue.ts': `${events}
        import { defineEndpoint as factory } from '@app/http/define-endpoint';
        const makeEndpoint = factory;
        declare const CONTRACT: object;
        export default makeEndpoint(CONTRACT, {
          handle: async (scope) => {
            const { audit: record } = scope;
            record(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED, {});
          },
        });
      `,
    });
    const green = checkEventReaderWriter(bound);
    assert.ok(green.sites >= green.minSites);
    assert.deepEqual(green.errors, []);
    assert.deepEqual(messages(green), []);
    const indexOnly = tree({
      'web-1/src/read.ts': reader,
      'web-1/src/application/http/define-endpoint/index.ts':
        'export const defineEndpoint = () => undefined;',
      'web-1/src/issue.ts': `${events}
        import { defineEndpoint } from '@app/http/define-endpoint';
        export default defineEndpoint(CONTRACT, {
          handle: ({ audit }) => audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED),
        });
      `,
    });
    rmSync(
      path.join(indexOnly, 'web-1/src/application/http/define-endpoint.ts'),
      { force: true }
    );
    assert.ok(
      messages(checkEventReaderWriter(indexOnly)).some(message =>
        message.includes('PAIRING_SESSION_ISSUED')
      )
    );
    const fake = tree({
      'web-1/src/read.ts': reader,
      'web-1/src/issue.ts': `${events}
        import { defineEndpoint } from '@app/http/define-endpoint';
        declare const CONTRACT: object;
        const text = "audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED)";
        const declared = { auditEvents: [APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED] };
        export default defineEndpoint(CONTRACT, {
          handle: async ({ audit }) => {
            const audit = (event: unknown) => event;
            audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED, {});
            void declared;
            void text;
          },
        });
      `,
    });
    const lied = checkEventReaderWriter(fake);
    assert.ok(lied.sites >= 1);
    assert.ok(
      messages(lied).some(message => message.includes('PAIRING_SESSION_ISSUED'))
    );
  });

  void it('flags a stale domain string and skips docs/', () => {
    const root = tree({
      'main/src/brand.ts': 'export const host = "nailfolio.com";\n',
      'docs/DOMAIN/note.md': 'nailfolio.com NailBook\n',
    });
    const found = messages(checkDocsSsot(root));
    assert.ok(found.some(message => message.includes('nailfolio.com')));
    assert.ok(!found.some(message => message.includes('note.md')));
  });
});
