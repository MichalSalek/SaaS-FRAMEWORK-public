// Mini trees for the event-reader-writer helper. Samples live in strings so a
// define-endpoint import is never a file the root tsconfig has to compile.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const helper = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'event-reader-writer.mjs'
);
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'nf-erw-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

const JSON_KEYS = [
  'root',
  'filesScanned',
  'readCallSitesTotal',
  'readSitesWithEventFilter',
  'resolvedCount',
  'dynamicCount',
  'outOfScopeCount',
  'allowedCount',
  'writeKeysCount',
  'appEventsMapLoaded',
  'scheduleFileExists',
  'scheduleInfoEventCount',
  'violations',
  'badEscapes',
];

function run(root) {
  const res = spawnSync(process.execPath, [helper, root], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, json, stderr: res.stderr };
}

function assertShape(json) {
  assert.ok(json, 'helper stdout is JSON');
  for (const key of JSON_KEYS) assert.ok(Object.hasOwn(json, key), key);
  assert.ok(json.readSitesWithEventFilter >= 1);
  assert.ok(json.readCallSitesTotal >= 1);
}

function missing(json) {
  return json.violations.flatMap(site => site.keys);
}

const EVENTS = `
declare const APP_EVENTS: {
  INFO: {
    PAIRING: {
      PAIRING_SESSION_ISSUED: 'PAIRING_SESSION_ISSUED';
      PAIRING_SESSION_CLAIMED: 'PAIRING_SESSION_CLAIMED';
      PAIRING_SESSION_REVOKED: 'PAIRING_SESSION_REVOKED';
      PAIRING_ACCESS_REVOKED: 'PAIRING_ACCESS_REVOKED';
    };
  };
};
`;

function reader(body) {
  return `
declare const DB_CLIENT: { use: { eventLog: { count: (a: unknown) => Promise<number> } } };
${EVENTS}
${body}
`;
}

const PAIRING_READER = reader(`
const PAIRING_EVENTS = [
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED,
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED,
  APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED,
];
export const readPairing = () =>
  DB_CLIENT.use.eventLog.count({ where: { event: { in: [...PAIRING_EVENTS] } } });
`);

function oneReader(member) {
  return reader(`
export const readOne = () =>
  DB_CLIENT.use.eventLog.count({ where: { event: ${member} } });
`);
}

const ISSUED = 'APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED';

void describe('event-reader-writer helper', () => {
  void it('exits 2 when the root argument is missing', () => {
    const res = spawnSync(process.execPath, [helper], { encoding: 'utf8' });
    assert.equal(res.status, 2);
    assert.equal(res.stdout, '');
  });

  void it('stays red when a migrated handler never calls audit', () => {
    const result = run(
      tree({
        'web-1/src/read.ts': PAIRING_READER,
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ ok, created }) => {
              ok({}, ${ISSUED});
              created({}, APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED);
            },
          });
        `,
      })
    );
    assert.equal(result.status, 1);
    assertShape(result.json);
    const keys = missing(result.json);
    assert.ok(keys.includes('PAIRING_SESSION_ISSUED'));
    assert.ok(keys.includes('PAIRING_SESSION_CLAIMED'));
    assert.ok(keys.includes('PAIRING_SESSION_REVOKED'));
    assert.ok(keys.includes('PAIRING_ACCESS_REVOKED'));
  });

  void it('stays red for prose, a declared list, and a local function named audit', () => {
    const prose = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/declared.ts': `
          ${EVENTS}
          const contract = {
            auditEvents: [${ISSUED}],
            successEvents: [${ISSUED}],
          };
          const text = "audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED)";
          const lie = "event-reader-writer-allow: not a comment";
          // audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED)
          export const unused = { contract, text, lie };
        `,
      })
    );
    assert.equal(prose.status, 1);
    assertShape(prose.json);
    assert.deepEqual(prose.json.badEscapes, []);
    assert.ok(missing(prose.json).includes('PAIRING_SESSION_ISSUED'));

    const fake = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          function audit(event) { return event; }
          audit(${ISSUED}, {});
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              function audit(event) { return event; }
              audit(${ISSUED}, {});
            },
          });
        `,
      })
    );
    assert.equal(fake.status, 1);
    assert.ok(missing(fake.json).includes('PAIRING_SESSION_ISSUED'));

    const wrongModule = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import { defineEndpoint } from './not-the-factory';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              audit(${ISSUED}, {});
            },
          });
        `,
      })
    );
    assert.equal(wrongModule.status, 1);
    assert.ok(missing(wrongModule.json).includes('PAIRING_SESSION_ISSUED'));
  });

  void it('does not expand a broad or dynamic event argument', () => {
    const result = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          declare const input: { kind: string };
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              const event = input.kind;
              audit(event, {});
              audit(APP_EVENTS.INFO.PAIRING, {});
            },
          });
        `,
      })
    );
    assert.equal(result.status, 1);
    assert.ok(missing(result.json).includes('PAIRING_SESSION_ISSUED'));
  });

  void it('writes only the event a real audit call passes', () => {
    const result = run(
      tree({
        'web-1/src/read.ts': PAIRING_READER,
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              audit(${ISSUED}, {});
            },
          });
        `,
      })
    );
    assert.equal(result.status, 1);
    const keys = missing(result.json);
    assert.ok(!keys.includes('PAIRING_SESSION_ISSUED'));
    assert.ok(keys.includes('PAIRING_SESSION_CLAIMED'));
    assert.ok(keys.includes('PAIRING_SESSION_REVOKED'));
    assert.ok(keys.includes('PAIRING_ACCESS_REVOKED'));
  });

  void it('turns the migrated pairing reader green for bound audit forms', () => {
    const result = run(
      tree({
        'web-1/src/read.ts': PAIRING_READER,
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              const record = audit;
              record(${ISSUED}, {});
            },
          });
        `,
        'web-1/src/claim.ts': `
          import { defineEndpoint as factory } from '@app/http/define-endpoint';
          const makeEndpoint = factory;
          declare const CONTRACT: object;
          ${EVENTS}
          export default makeEndpoint(CONTRACT, {
            handle: async ({ audit: record }) => {
              const claimed = APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED;
              record(claimed, {});
            },
          });
        `,
        'web-1/src/revoke.ts': `
          import { bindEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export const revoke = bindEndpoint(CONTRACT, async (scope) => {
            scope.audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED, {});
          });
        `,
        'web-1/src/switch.ts': `
          import { defineEndpointSwitch } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          const bindings = [
            {
              async handle(scope) {
                const { audit: record } = scope;
                record(APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED, {});
              },
            },
          ];
          export default defineEndpointSwitch(bindings);
        `,
      })
    );
    assert.equal(result.status, 0);
    assertShape(result.json);
    assert.deepEqual(result.json.violations, []);
    assert.deepEqual(result.json.badEscapes, []);
    assert.equal(result.json.appEventsMapLoaded, false);
    assert.equal(result.json.scheduleFileExists, false);
  });

  void it('accepts a namespace import and a const alias of scope.audit', () => {
    const result = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import * as http from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export const binding = http.bindEndpoint(CONTRACT, async (scope) => {
            const record = scope.audit;
            record(${ISSUED}, {});
          });
        `,
      })
    );
    assert.equal(result.status, 0);
    assert.deepEqual(result.json.violations, []);
  });

  void it('rejects lookalike factory modules and accepts a relative canonical import', () => {
    const lookalike = (specifier) =>
      run(
        tree({
          'web-1/src/read.ts': oneReader(ISSUED),
          'web-1/src/issue.ts': `
            import { defineEndpoint } from '${specifier}';
            declare const CONTRACT: object;
            ${EVENTS}
            export default defineEndpoint(CONTRACT, {
              handle: async ({ audit }) => {
                audit(${ISSUED}, {});
              },
            });
          `,
        })
      );
    for (const specifier of ['./fake-define-endpoint', './fake/define-endpoint']) {
      const result = lookalike(specifier);
      assert.equal(result.status, 1, specifier);
      assert.ok(missing(result.json).includes('PAIRING_SESSION_ISSUED'), specifier);
    }
    const relative = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import { defineEndpoint } from './application/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              audit(${ISSUED}, {});
            },
          });
        `,
      })
    );
    assert.equal(relative.status, 0);
    assert.deepEqual(relative.json.violations, []);
  });

  void it('counts both branches of a literal conditional and neither of a mixed one', () => {
    const both = run(
      tree({
        'web-1/src/read.ts': reader(`
          export const readBoth = () => DB_CLIENT.use.eventLog.count({
            where: {
              event: {
                in: [
                  ${ISSUED},
                  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
                ],
              },
            },
          });
        `),
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          declare const flag: boolean;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              audit(
                flag
                  ? ${ISSUED}
                  : APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
                {}
              );
            },
          });
        `,
      })
    );
    assert.equal(both.status, 0);
    assert.deepEqual(both.json.violations, []);

    const mixed = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          declare const flag: boolean;
          declare const input: { event: string };
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              audit(flag ? ${ISSUED} : input.event, {});
            },
          });
        `,
      })
    );
    assert.equal(mixed.status, 1);
    assert.ok(missing(mixed.json).includes('PAIRING_SESSION_ISSUED'));
  });

  void it('keeps a parameter audit call and drops a later local shadow', () => {
    const result = run(
      tree({
        'web-1/src/read.ts': PAIRING_READER,
        'web-1/src/issue.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }) => {
              audit(${ISSUED}, {});
              const audit = (event) => event;
              audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED, {});
            },
          });
        `,
      })
    );
    assert.equal(result.status, 1);
    const keys = missing(result.json);
    assert.ok(!keys.includes('PAIRING_SESSION_ISSUED'));
    assert.ok(keys.includes('PAIRING_SESSION_CLAIMED'));
  });

  void it('follows a typed EndpointScope binding and ignores a typed dummy', () => {
    const anomalyReader = reader(`
      const PAIRING_EVENTS = [
        ${ISSUED},
        APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
        APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED,
        APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED,
      ] as const;
      export const readPairing = () =>
        DB_CLIENT.use.eventLog.count({
          where: { event: { in: [...PAIRING_EVENTS] } },
        });
    `);
    const typed = run(
      tree({
        'web-1/src/anomaly-alerts.operation.ts': anomalyReader,
        'web-1/src/issue.ts': `
          import { defineEndpoint, type EndpointScope } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async (scope: EndpointScope) => {
              const record: EndpointScope['audit'] = scope.audit;
              record(${ISSUED}, {});
            },
          });
        `,
        'web-1/src/claim.ts': `
          import { bindEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export const claim = bindEndpoint(CONTRACT, async ({ audit }: EndpointScope) => {
            audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED, {});
          });
        `,
        'web-1/src/revoke.ts': `
          import { defineEndpoint } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async ({ audit }: EndpointScope) => {
              audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED, {});
              audit(APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED, {});
            },
          });
        `,
      })
    );
    assert.equal(typed.status, 0);
    assert.deepEqual(typed.json.violations, []);

    const typeOnly = run(
      tree({
        'web-1/src/anomaly-alerts.operation.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import type { defineEndpoint, EndpointScope } from '@app/http/define-endpoint';
          declare function defineEndpoint(...args: unknown[]): unknown;
          declare const CONTRACT: object;
          ${EVENTS}
          export default defineEndpoint(CONTRACT, {
            handle: async (scope: EndpointScope) => {
              scope.audit(${ISSUED}, {});
            },
          });
        `,
      })
    );
    assert.equal(typeOnly.status, 1);
    assert.ok(missing(typeOnly.json).includes('PAIRING_SESSION_ISSUED'));

    const declared = run(
      tree({
        'web-1/src/anomaly-alerts.operation.ts': oneReader(ISSUED),
        'web-1/src/issue.ts': `
          import { defineEndpoint, type EndpointScope } from '@app/http/define-endpoint';
          declare const CONTRACT: object;
          declare const loose: EndpointScope;
          ${EVENTS}
          loose.audit(${ISSUED}, {});
          export default defineEndpoint(CONTRACT, {
            handle: async (scope: EndpointScope) => {
              const record: EndpointScope['audit'] = event => event;
              record(${ISSUED}, {});
              const nested = (audit: EndpointScope['audit']) => {
                audit(${ISSUED}, {});
              };
              nested(scope.audit);
            },
          });
        `,
      })
    );
    assert.equal(declared.status, 1);
    assert.ok(missing(declared.json).includes('PAIRING_SESSION_ISSUED'));
  });

  void it('still counts recordAuditEvent_IO, infoEvent, and the value map', () => {
    const direct = run(
      tree({
        'web-1/src/read.ts': oneReader(ISSUED),
        'web-1/src/write.ts': `
          declare const recordAuditEvent_IO: (a: unknown) => Promise<unknown>;
          ${EVENTS}
          export const write = () =>
            recordAuditEvent_IO({ eventName: ${ISSUED} });
        `,
      })
    );
    assert.equal(direct.status, 0);
    assert.deepEqual(direct.json.violations, []);

    const schedule = run(
      tree({
        'web-1/src/read.ts': `
          declare const DB_CLIENT: { use: { eventLog: { findFirst: (a: unknown) => Promise<unknown> } } };
          export const read = () =>
            DB_CLIENT.use.eventLog.findFirst({ where: { event: 'EMAIL_WELCOME_SENT' } });
        `,
        '.shared-kernel/domain/email/email-schedule.config.ts': `
          export const rules = [{ infoEvent: 'EMAIL_WELCOME_SENT' }];
        `,
      })
    );
    assert.equal(schedule.status, 0);
    assert.equal(schedule.json.scheduleFileExists, true);
    assert.equal(schedule.json.scheduleInfoEventCount, 1);
    assert.deepEqual(schedule.json.violations, []);

    const renamed = run(
      tree({
        'web-1/src/read.ts': `
          declare const DB_CLIENT: { use: { eventLog: { findFirst: (a: unknown) => Promise<unknown> } } };
          declare const APP_EVENTS: { INFO: { PAIRING: { PAIRING_SESSION_ISSUED: 'ISSUED_RUNTIME' } } };
          declare const recordAuditEvent_IO: (a: unknown) => Promise<unknown>;
          export const write = () =>
            recordAuditEvent_IO({ eventName: APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED });
          export const readMember = () =>
            DB_CLIENT.use.eventLog.findFirst({
              where: { event: APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED },
            });
          export const readPropertyName = () =>
            DB_CLIENT.use.eventLog.findFirst({ where: { event: 'PAIRING_SESSION_ISSUED' } });
        `,
        '.shared-kernel/domain/events/app-events.const.ts': `
          export const APP_EVENTS = {
            INFO: { PAIRING: { PAIRING_SESSION_ISSUED: 'ISSUED_RUNTIME' } },
          };
        `,
      })
    );
    assert.equal(renamed.status, 1);
    assert.equal(renamed.json.appEventsMapLoaded, true);
    assert.deepEqual(missing(renamed.json), ['PAIRING_SESSION_ISSUED']);
  });
});
