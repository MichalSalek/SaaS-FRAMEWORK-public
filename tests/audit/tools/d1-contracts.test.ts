// Must-fail / must-pass for the fourteen D1 shell guards, on one mini tree.
//
// DECISION: the old shell treated any `defineEndpoint(FOO_CONTRACTS.KEY)` call text as a binding,
// including `declare const defineEndpoint` in tests/audit/_fixtures. This tool requires a value
// import that resolves to web-1/src/application/http/define-endpoint.ts. A comment, a string, a
// type-only import, or a lookalike module is not a binding and cannot hide an uncontracted handler.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { run, ADMIN_ONLY_BASELINE } from './d1-contracts';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const HANDLER = `import { defineEndpoint as bind } from '@app/http/define-endpoint';

export default bind(
  WIDGET_CONTRACTS.WIDGET_CREATE,
  {
    handle: () => undefined,
  },
);
`;

function defaults(): Record<string, string> {
  return {
    'web-1/src/application/http/define-endpoint.ts': 'export {};',
    'web-1/src/application/http/http.responses.utils.ts': 'export {};',
    '.shared-kernel/domain/http/http.config.ts':
      "export const API_VER = '/api/v1/';\n",
    '.shared-kernel/domain/events/app-events.const.ts': `export const APP_EVENTS = {
      COMMANDS: { WIDGET: { WIDGET_CREATE: 'WIDGET_CREATE' } },
      QUERIES: {},
      CONFIRMATIONS: {},
      INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED' } },
    };
`,
    '.shared-kernel/domain/routing/routing.config.ts': `import { API_VER } from '../http/http.config';
export const ROUTES_API = Object.freeze({
  WIDGET_CREATE: \`\${API_VER}widget/create\`,
});
`,
    '.shared-kernel/domain/http/http-methods.config.ts':
      "export const API_HTTP_METHODS = Object.freeze({ WIDGET_CREATE: 'POST' });\n",
    '.shared-kernel/application/role-permissions.ts': `export const BASE_PERMISSIONS = [
  APP_EVENTS.COMMANDS.WIDGET.WIDGET_CREATE,
] as const;
export const LOGGED_USER_PERMISSIONS = [...BASE_PERMISSIONS] as const;
export const STYLIST_SPECIFIC_PERMISSIONS = [] as const;
export const CLIENT_SPECIFIC_PERMISSIONS = [] as const;
`,
    '.shared-kernel/domain/commands-and-queries/cqrs.config.ts': `export const EVENTS = Object.freeze({
  COMMANDS: { WIDGET: Object.values(APP_EVENTS.COMMANDS.WIDGET) },
  QUERIES: {},
  CONFIRMATIONS: { LINK: Object.values(APP_EVENTS.CONFIRMATIONS) },
  INFO: { WIDGET: Object.values(APP_EVENTS.INFO.WIDGET) },
});
`,
    '.shared-kernel/domain/event-log/event_log.config.ts':
      "export const allowedEventLogTypes = { LOGIN: ['WIDGET_AUDITED'] };\n",
    '.shared-kernel/domain/email/email-schedule.config.ts':
      'export const EMAIL_SCHEDULE = {};\n',
    '.shared-kernel/application/contracts/raw-protocols.ts': `export const RAW_PROTOCOLS = [
  { id: 'INTERNAL_HEALTH_PUBLIC', file: 'v1/internal/health-public/index.ts', methods: ['GET'], access: 'public', reason: 'probe' },
];
`,
    '.shared-kernel/application/contracts/api-contracts.registry.ts':
      'export const API_CONTRACT_LIST = { contracts: WIDGET_CONTRACTS };\n',
    '.shared-kernel/domain/widget/widget.contracts.ts': `export const WIDGET_CONTRACTS = defineContracts({
  WIDGET_CREATE: {
    kind: 'COMMAND',
    path: 'widget/create',
    method: 'POST',
    body: z.object({}),
    query: null,
    access: 'PUBLIC',
    authCheck: true,
    limiterTier: 'default',
    group: 'WIDGET',
    successEvents: ['WIDGET_CREATED'],
    auditEvents: ['WIDGET_AUDITED'],
  },
});
`,
    '.shared-kernel/models/widget/widget.dto.ts': `export type WIDGET_DTO_API_V1 = {
  WIDGET_CREATE: {
    REQUEST: ContractRequest;
    RESPONSE: ContractResponse;
    RESPONSE_ERROR: ContractResponseError;
    IO_CLIENT_FUNCTION: ContractIOClientFunction;
  };
};
`,
    'main/src/application/http/http.endpoints.ts':
      'const ROUTE_ALIASES = {};\n',
    'web-1/src/application/http/rate-limit.middleware.ts': `export const RATE_LIMIT_CONFIG = {
  STRICT_ENDPOINTS: [
    '/api/auth/',
    // <generated:contracts:strict-routes>
    // </generated:contracts:strict-routes>
  ],
};
`,
    'web-1/src/application/permissions/permissions.seed.ts': `export const ROLES = {
  [SystemRoleId.MASTER_ADMIN]: getAllEvents().map(e => e.event_name),
};
`,
    'web-1/src/pages/api/v1/widget/create/index.ts': HANDLER,
    'web-1/src/pages/api/v1/internal/health-public/index.ts':
      "export default withPublicHandler({ allowedMethods: ['GET', 'HEAD'], handle: () => undefined });\n",
    'web-1/src/pages/api/auth/[...all].ts':
      '// Better Auth catch-all. Method is not compared.\nexport default function all() { return undefined; }\n',
  };
}

function tree(overrides: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-d1-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries({ ...defaults(), ...overrides })) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

function one(
  root: string,
  name: string,
  allowlist: Record<string, string> = {}
): CheckResult {
  const found = run(root, allowlist).find(item => item.name === name);
  assert.ok(found, name);
  return found;
}

function messages(
  root: string,
  name: string,
  allowlist: Record<string, string> = {}
): string[] {
  return one(root, name, allowlist).findings.map(finding => finding.message);
}

function dtoBlock(key: string): string {
  return `  ${key}: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X; IO_CLIENT_FUNCTION: X };
`;
}

/** Four-module admin aggregate: shared metadata, two command maps, two query maps. */
function adminSplit(
  opts: { readonly rogue?: boolean; readonly grant?: boolean } = {}
): Record<string, string> {
  const tieA = `  TIE: {
    ...ADMIN,
    access: 'PUBLIC',
    kind: 'COMMAND', path: 'admin/tie-a', method: 'POST', body: z.object({}), query: null,
    successEvents: [], auditEvents: [],
  },
`;
  const commandBExtra = opts.rogue
    ? `  NOT_IN_EVENTS: {
    ...ADMIN,
    kind: 'COMMAND', path: 'admin/missing', method: 'POST', body: z.object({}), query: null,
    successEvents: [], auditEvents: [],
  },
`
    : '';
  const grants = opts.grant
    ? `  APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_EMAIL_HISTORY,
`
    : '';
  const plainImport = opts.rogue
    ? `import { PLAIN_MAP } from './evil.contracts';\n`
    : '';
  const plainSpread = opts.rogue ? '  ...PLAIN_MAP,\n' : '';
  const files: Record<string, string> = {
    '.shared-kernel/domain/admin/admin-contract.shared.ts': `import { missingRuntime } from 'this-package-is-not-installed';
export const ADMIN = {
  group: 'ADMIN' as const,
  access: 'ADMIN' as const,
  authCheck: true as const,
  limiterTier: 'default' as const,
};
throw new Error('do not execute contract modules');
void missingRuntime;
`,
    '.shared-kernel/domain/admin/admin-command-a.contracts.ts': `import { ADMIN } from './admin-contract.shared';
export const ADMIN_COMMAND_A = defineContracts({
  SEND_LOG: {
    ...ADMIN,
    access: 'PUBLIC',
    kind: 'COMMAND', path: 'admin/send-log', method: 'POST', body: z.object({}), query: null,
    successEvents: [], auditEvents: [],
  },
  BECOME_USER: {
    ...ADMIN,
    kind: 'COMMAND', path: 'admin/become-user', method: 'POST', body: z.object({}), query: null,
    successEvents: [], auditEvents: [],
  },
${tieA}});
`,
    '.shared-kernel/domain/admin/admin-command-b.contracts.ts': `import { ADMIN } from './admin-contract.shared';
export const ADMIN_COMMAND_B = defineContracts({
  TIE: {
    ...ADMIN,
    kind: 'COMMAND', path: 'admin/tie-b', method: 'POST', body: z.object({}), query: null,
    successEvents: [], auditEvents: [],
  },
  ADMIN_BULK_DISABLE: {
    ...ADMIN,
    kind: 'COMMAND', path: 'admin/bulk-disable', method: 'POST', body: z.object({}), query: null,
    successEvents: [], auditEvents: [],
  },
${commandBExtra}});
`,
    '.shared-kernel/domain/admin/admin-query-a.contracts.ts': `import { ADMIN } from './admin-contract.shared';
export const ADMIN_QUERY_A = defineContracts({
  ADMIN_GET_PERMISSIONS: {
    ...ADMIN,
    kind: 'QUERY', path: 'admin/permissions', method: 'GET', body: null, query: null,
    successEvents: [], auditEvents: [],
  },
});
`,
    '.shared-kernel/domain/admin/admin-query-b.contracts.ts': `import { ADMIN } from './admin-contract.shared';
export const ADMIN_QUERY_B = defineContracts({
  ADMIN_GET_EMAIL_HISTORY: {
    ...ADMIN,
    kind: 'QUERY', path: 'admin/email-history', method: 'GET', body: null, query: null,
    successEvents: [], auditEvents: [],
  },
});
`,
    '.shared-kernel/domain/admin/admin.contracts.ts': `${plainImport}import { ADMIN_COMMAND_A } from './admin-command-a.contracts';
import { ADMIN_COMMAND_B } from './admin-command-b.contracts';
import { ADMIN_QUERY_A } from './admin-query-a.contracts';
import { ADMIN_QUERY_B } from './admin-query-b.contracts';
export const ADMIN_CONTRACTS = Object.freeze({
  ...ADMIN_COMMAND_A,
  ...ADMIN_COMMAND_B,
  ...ADMIN_QUERY_A,
  ...ADMIN_QUERY_B,
${plainSpread}});
`,
    '.shared-kernel/domain/admin/evil.contracts.ts': `export const PLAIN_MAP = {
  FAKE_OP: {
    kind: 'COMMAND', path: 'admin/fake', method: 'POST', body: z.object({}), query: null,
    access: 'ADMIN', authCheck: true, limiterTier: 'default', group: 'ADMIN',
    successEvents: [], auditEvents: [],
  },
};
export const GHOST_CONTRACTS = {
  GHOST_OP: {
    kind: 'COMMAND', path: 'admin/ghost', method: 'POST', body: z.object({}), query: null,
    access: 'ADMIN', authCheck: true, limiterTier: 'default', group: 'ADMIN',
    successEvents: [], auditEvents: [],
  },
};
// defineContracts({ COMMENT_OP: { kind: 'COMMAND', path: 'admin/comment', method: 'POST' } })
const label = "export const SUFFIX_CONTRACTS = defineContracts({ STRING_OP: { kind: 'COMMAND' } })";
void label;
`,
    '.shared-kernel/application/contracts/api-contracts.registry.ts': `export const API_CONTRACT_LIST = {
  contracts: WIDGET_CONTRACTS,
  admin: ADMIN_CONTRACTS,
};
`,
    '.shared-kernel/domain/events/app-events.const.ts': `export const APP_EVENTS = {
  COMMANDS: {
    WIDGET: { WIDGET_CREATE: 'WIDGET_CREATE', DECOY_OP: 'DECOY_OP' },
    ADMIN: {
      SEND_LOG: 'SEND_LOG',
      BECOME_USER: 'BECOME_USER',
      TIE: 'TIE',
      ADMIN_BULK_DISABLE: 'ADMIN_BULK_DISABLE',
    },
  },
  QUERIES: {
    ADMIN: {
      ADMIN_GET_PERMISSIONS: 'ADMIN_GET_PERMISSIONS',
      ADMIN_GET_EMAIL_HISTORY: 'ADMIN_GET_EMAIL_HISTORY',
    },
  },
  CONFIRMATIONS: {},
  INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED' } },
};
`,
    '.shared-kernel/application/role-permissions.ts': `export const BASE_PERMISSIONS = [
  APP_EVENTS.COMMANDS.WIDGET.WIDGET_CREATE,
  APP_EVENTS.COMMANDS.ADMIN.SEND_LOG,
${grants}] as const;
export const LOGGED_USER_PERMISSIONS = [] as const;
export const STYLIST_SPECIFIC_PERMISSIONS = [] as const;
export const CLIENT_SPECIFIC_PERMISSIONS = [] as const;
`,
    '.shared-kernel/models/admin/admin-part-1.dto.ts': `export type ADMIN_DTO_API_V1_PART_1 = {
${dtoBlock('SEND_LOG')}${dtoBlock('BECOME_USER')}${dtoBlock('TIE')}${dtoBlock('ADMIN_BULK_DISABLE')}};
`,
    '.shared-kernel/models/admin/admin-part-2.dto.ts': `export type ADMIN_DTO_API_V1_PART_2 = {
${dtoBlock('ADMIN_GET_PERMISSIONS')}${dtoBlock('ADMIN_GET_EMAIL_HISTORY')}};
export type ADMIN_DTO_DECOY = {
${dtoBlock('DECOY_OP')}};
`,
    '.shared-kernel/models/admin/admin.dto.ts': `import type { ADMIN_DTO_API_V1_PART_1 } from './admin-part-1.dto';
import type { ADMIN_DTO_API_V1_PART_2 } from './admin-part-2.dto';
export type ADMIN_DTO_API_V1 = ADMIN_DTO_API_V1_PART_1 & ADMIN_DTO_API_V1_PART_2;
`,
  };
  if (opts.rogue) {
    files['.shared-kernel/domain/admin/admin-rogue.contracts.ts'] =
      `export const ADMIN_ROGUE = defineContracts({
  ROGUE_OP: {
    kind: 'COMMAND', path: 'admin/rogue', method: 'POST', body: z.object({}), query: null,
    access: 'ADMIN', authCheck: true, limiterTier: 'default', group: 'ADMIN',
    successEvents: [], auditEvents: [],
  },
});
`;
  }
  return files;
}

void describe('d1-contracts', () => {
  void it('accepts a coherent contract, binding, raw protocol and catch-all', () => {
    const root = tree();
    const results = run(root, {});
    for (const item of results) {
      assert.deepEqual(item.findings, [], item.name);
      assert.deepEqual(item.errors, [], item.name);
    }
    assert.ok(one(root, 'd1:contract-shape').sites >= 1);
    assert.ok(one(root, 'd1:bindings').sites >= 3);
  });

  void it('rejects a command with no body and a public-no-grant that still checks auth', () => {
    const root = tree({
      '.shared-kernel/domain/widget/widget.contracts.ts': `export const WIDGET_CONTRACTS = defineContracts({
        WIDGET_CREATE: {
          kind: 'COMMAND', path: 'widget/create', method: 'POST',
          body: null, query: null, access: 'PUBLIC_NO_GRANT', authCheck: true,
          limiterTier: 'default', group: 'WIDGET', successEvents: ['WIDGET_CREATED'], auditEvents: [],
        },
      });
`,
    });
    const text = messages(root, 'd1:contract-shape').join('\n');
    assert.match(text, /COMMAND requires a body schema/);
    assert.match(text, /PUBLIC_NO_GRANT requires authCheck: false/);
  });

  void it('rejects a query that carries a body', () => {
    const root = tree({
      '.shared-kernel/domain/widget/widget.contracts.ts': `export const WIDGET_CONTRACTS = defineContracts({
        WIDGET_CREATE: {
          kind: 'QUERY', path: 'widget/create', method: 'GET',
          body: z.object({}), query: null, access: 'PUBLIC', authCheck: true,
          limiterTier: 'default', group: 'WIDGET', successEvents: ['WIDGET_CREATED'], auditEvents: ['WIDGET_AUDITED'],
        },
      });
`,
      '.shared-kernel/domain/http/http-methods.config.ts':
        "export const API_HTTP_METHODS = Object.freeze({ WIDGET_CREATE: 'GET' });\n",
    });
    assert.match(
      messages(root, 'd1:contract-shape').join('\n'),
      /QUERY has body: null/
    );
  });

  void it('rejects a handler whose file path is not the contract path', () => {
    const root = tree({
      'web-1/src/pages/api/v1/widget/create/index.ts': '// moved\n',
      'web-1/src/pages/api/v1/widget/elsewhere/index.ts': HANDLER,
    });
    assert.match(
      messages(root, 'd1:bindings').join('\n'),
      /bound in v1\/widget\/elsewhere\/index\.ts but the contract path is widget\/create/
    );
  });

  void it('does not treat a comment, a string, or a type-only import as a binding', () => {
    const root = tree({
      'web-1/src/pages/api/v1/widget/fake/index.ts': `// defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE)
const label = "defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE)";
import type { defineEndpoint } from '@app/http/define-endpoint';
declare function defineEndpoint(...args: unknown[]): unknown;
void label;
export default defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE, { handle: () => undefined });
`,
    });
    const text = messages(root, 'd1:bindings').join('\n');
    assert.match(text, /not a value import from define-endpoint/);
    assert.doesNotMatch(text, /fake\/index\.ts but the contract path/);
  });

  void it('accepts a namespace import and a same-file const alias', () => {
    const root = tree({
      'web-1/src/pages/api/v1/widget/create/index.ts': `import * as ep from '@app/http/define-endpoint';
const bind = ep.defineEndpoint;
export default bind(
  WIDGET_CONTRACTS.WIDGET_CREATE,
  { handle: () => undefined },
);
`,
    });
    assert.deepEqual(messages(root, 'd1:bindings'), []);
  });

  void it('accepts a relative import of the canonical factory and rejects lookalikes', () => {
    const relative = tree({
      'web-1/src/pages/api/v1/widget/create/index.ts': `import { defineEndpoint as bind } from '../../../../../application/http/define-endpoint';
export default bind(WIDGET_CONTRACTS.WIDGET_CREATE, { handle: () => undefined });
`,
    });
    assert.deepEqual(messages(relative, 'd1:bindings'), []);
    const lookalike = tree({
      'web-1/src/pages/api/v1/widget/near/index.ts': `import { defineEndpoint } from './fake-define-endpoint';
export default defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE, { handle: () => undefined });
`,
      'web-1/src/pages/api/v1/widget/dir/index.ts': `import { defineEndpoint } from './fake/define-endpoint';
export default defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE, { handle: () => undefined });
`,
    });
    const findings = one(lookalike, 'd1:bindings').findings;
    const files = findings.map(finding => finding.file).join('\n');
    assert.match(files, /widget\/near\/index\.ts/);
    assert.match(files, /widget\/dir\/index\.ts/);
    assert.ok(
      findings.every(finding =>
        finding.message.includes('not a value import from define-endpoint')
      )
    );
    assert.doesNotMatch(
      findings.map(finding => finding.message).join('\n'),
      /but the contract path/
    );
  });

  void it('does not bind when the scan tree has only define-endpoint/index.ts', () => {
    const root = tree({
      'web-1/src/application/http/define-endpoint/index.ts':
        'export function defineEndpoint() { return undefined; }\n',
      'web-1/src/pages/api/v1/widget/create/index.ts': `import { defineEndpoint } from '@app/http/define-endpoint';
export default defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE, { handle: () => undefined });
`,
    });
    rmSync(path.join(root, 'web-1/src/application/http/define-endpoint.ts'));
    const text = messages(root, 'd1:bindings').join('\n');
    assert.match(text, /not a value import from define-endpoint/);
    assert.doesNotMatch(text, /but the contract path/);
  });

  void it('binds when the canonical define-endpoint.ts file is in the scan tree', () => {
    const root = tree({
      'web-1/src/application/http/define-endpoint.ts':
        'export function defineEndpoint() { return undefined; }\n',
    });
    assert.deepEqual(messages(root, 'd1:bindings'), []);
  });

  void it('prefers define-endpoint.ts over a define-endpoint directory', () => {
    const root = tree({
      'web-1/src/application/http/define-endpoint.ts':
        'export function defineEndpoint() { return undefined; }\n',
      'web-1/src/application/http/define-endpoint/index.ts':
        'export function defineEndpoint() { return undefined; }\n',
    });
    assert.deepEqual(messages(root, 'd1:bindings'), []);
  });

  void it('rejects a phantom method key and an alias whose target is not a route', () => {
    const root = tree({
      '.shared-kernel/domain/http/http-methods.config.ts':
        "export const API_HTTP_METHODS = Object.freeze({ WIDGET_CREATE: 'POST', PHANTOM: 'GET' });\n",
      'main/src/application/http/http.endpoints.ts':
        "const ROUTE_ALIASES = { USER_LOGOUT: 'NO_SUCH_ROUTE' };\n",
    });
    const text = messages(root, 'd1:registries').join('\n');
    assert.match(text, /PHANTOM is in API_HTTP_METHODS but not in ROUTES_API/);
    assert.match(text, /alias USER_LOGOUT → NO_SUCH_ROUTE/);
  });

  void it('accepts an alias whose target exists and flags a route that matches neither', () => {
    const root = tree({
      '.shared-kernel/domain/routing/routing.config.ts': `import { API_VER } from '../http/http.config';
export const ROUTES_API = Object.freeze({
  WIDGET_CREATE: \`\${API_VER}widget/create\`,
  SALON_STAFF: \`\${API_VER}salon/staff\`,
  HAND_WRITTEN: \`\${API_VER}hand/written\`,
});
`,
      '.shared-kernel/domain/http/http-methods.config.ts':
        "export const API_HTTP_METHODS = Object.freeze({ WIDGET_CREATE: 'POST', SALON_STAFF_INVITE: 'POST' });\n",
      'main/src/application/http/http.endpoints.ts':
        "const ROUTE_ALIASES = { SALON_STAFF_INVITE: 'SALON_STAFF' };\n",
    });
    const text = messages(root, 'd1:registries').join('\n');
    assert.doesNotMatch(text, /SALON_STAFF_INVITE/);
    assert.match(text, /HAND_WRITTEN is in ROUTES_API but is not a contract/);
  });

  void it('compares a legacy handler method and leaves a non-literal unresolved', () => {
    const mismatch = tree({
      'web-1/src/pages/api/v1/widget/legacy/index.ts': `export default defineHandler({
  eventName: APP_EVENTS.COMMANDS.WIDGET.WIDGET_CREATE,
  method: 'get',
  validate: VALIDATION_POLICY.validators.widget,
});
`,
    });
    assert.match(
      messages(mismatch, 'd1:bindings').join('\n'),
      /WIDGET_CREATE declares GET but API_HTTP_METHODS says POST/
    );
    const unresolved = tree({
      'web-1/src/pages/api/v1/widget/legacy/index.ts': `export default defineHandler({
  eventName: APP_EVENTS.COMMANDS.WIDGET.WIDGET_CREATE,
  method: METHODS.POST,
  validate: VALIDATION_POLICY.validators.widget,
});
`,
    });
    assert.match(
      messages(unresolved, 'd1:bindings').join('\n'),
      /handler method is unresolved/
    );
  });

  void it('does not fail a multi-method declaration or an extra HEAD on a raw probe', () => {
    const root = tree({
      'web-1/src/pages/api/v1/widget/legacy/index.ts': `export default defineHandler({
  method: isPost ? 'post' : 'get',
  validate: VALIDATION_POLICY.validators.widget,
});
`,
    });
    const text = messages(root, 'd1:bindings').join('\n');
    assert.doesNotMatch(text, /declares GET but/);
    assert.doesNotMatch(text, /declares POST but/);
    assert.doesNotMatch(text, /health-public/);
  });

  void it('requires a raw protocol verb, including HEAD copied off req.method', () => {
    const missing = tree({
      '.shared-kernel/application/contracts/raw-protocols.ts': `export const RAW_PROTOCOLS = [
  { id: 'EMAIL_UNSUBSCRIBE', file: 'v1/email/unsubscribe/index.ts', methods: ['GET', 'HEAD', 'POST', 'OPTIONS'], access: 'public', reason: 'redirect' },
];
`,
      'web-1/src/pages/api/v1/internal/health-public/index.ts':
        '// not the protocol under test\n',
      'web-1/src/pages/api/v1/email/unsubscribe/index.ts': `const method = (req.method || '').toUpperCase();
if (method === 'GET') { return; }
export default HTTPRequestHandlerMiddleware(req, res, { contestedHTTPMethod: 'post' });
`,
    });
    assert.match(
      messages(missing, 'd1:bindings').join('\n'),
      /does not declare HEAD/
    );
    const present = tree({
      '.shared-kernel/application/contracts/raw-protocols.ts': `export const RAW_PROTOCOLS = [
  { id: 'EMAIL_UNSUBSCRIBE', file: 'v1/email/unsubscribe/index.ts', methods: ['GET', 'HEAD', 'POST', 'OPTIONS'], access: 'public', reason: 'redirect' },
];
`,
      'web-1/src/pages/api/v1/internal/health-public/index.ts':
        '// unused in this fixture\n',
      'web-1/src/pages/api/v1/email/unsubscribe/index.ts': `const method = (req.method || '').toUpperCase();
const isGetLike = method === 'GET' || method === 'HEAD';
void isGetLike;
export default HTTPRequestHandlerMiddleware(req, res, { contestedHTTPMethod: 'post' });
`,
    });
    assert.doesNotMatch(
      messages(present, 'd1:bindings').join('\n'),
      /unsubscribe/
    );
  });

  void it('rejects a new auth file and still requires the catch-all', () => {
    const extra = tree({
      'web-1/src/pages/api/auth/extra.ts':
        'export default function extra() { return undefined; }\n',
    });
    assert.ok(
      one(extra, 'd1:bindings').findings.some(finding =>
        finding.file.endsWith('auth/extra.ts')
      )
    );
    const gone = tree({ 'web-1/src/pages/api/auth/[...all].ts': '' });
    // empty overwrite still writes the file. Remove by pointing the catch-all check at a deleted path:
    rmSync(path.join(gone, 'web-1/src/pages/api/auth/[...all].ts'));
    assert.match(
      messages(gone, 'd1:bindings').join('\n'),
      /Better Auth catch-all is missing/
    );
  });

  void it('rejects an unvalidated write and a write no-op that is not allowlisted', () => {
    const bare = tree({
      'web-1/src/pages/api/v1/widget/bare/index.ts': `export default defineHandler({
  method: 'post',
});
`,
    });
    assert.match(
      messages(bare, 'd1:validation').join('\n'),
      /handler has no request validator/
    );
    const noop = tree({
      'web-1/src/pages/api/v1/widget/bare/index.ts': `export default defineHandler({
  method: 'post',
  validate: NO_VALIDATION,
});
`,
    });
    assert.match(
      messages(noop, 'd1:validation').join('\n'),
      /write-method no-op validator is not on the allowlist/
    );
    const listed = tree({
      'web-1/src/pages/api/v1/widget/bare/index.ts': `export default defineHandler({
  method: 'post',
  validate: NO_VALIDATION,
});
`,
    });
    assert.doesNotMatch(
      messages(listed, 'd1:validation', {
        'v1/widget/bare/index.ts': 'bodyless write owned by the session',
      }).join('\n'),
      /bare/
    );
  });

  void it('does not treat a GET no-op or a real schema as a write no-op, and flags a stale entry', () => {
    const get = tree({
      'web-1/src/pages/api/v1/widget/bare/index.ts': `export default defineHandler({
  method: 'get',
  validate: NO_VALIDATION,
});
`,
    });
    assert.doesNotMatch(messages(get, 'd1:validation').join('\n'), /no-op/);
    const schema = tree({
      'web-1/src/pages/api/v1/widget/bare/index.ts': `export default defineHandler({
  method: 'post',
  validate: z.object({}),
});
`,
    });
    assert.doesNotMatch(messages(schema, 'd1:validation').join('\n'), /no-op/);
    const stale = tree();
    assert.match(
      messages(stale, 'd1:validation', { 'v1/gone/index.ts': 'retired' }).join(
        '\n'
      ),
      /allowlist entry is stale/
    );
  });

  void it('ignores a no-op inside a comment and still sees the missing validator', () => {
    const root = tree({
      'web-1/src/pages/api/v1/widget/bare/index.ts': `// validate: VALIDATION_POLICY.validators.widget
/* defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE) */
export default defineHandler({
  method: 'post',
});
`,
    });
    assert.match(
      messages(root, 'd1:validation').join('\n'),
      /handler has no request validator/
    );
  });

  void it('rejects a raw string event and an APP_EVENTS value in the payload slot', () => {
    const root = tree({
      'web-1/src/application/http/sample.ts': `import { respondSuccess, respondBadRequest, respondForbidden } from '@app/http/http.responses.utils';
respondSuccess(res, data, 'RAW');
respondBadRequest(res, 'ALSO_RAW');
respondForbidden(
  res,
  APP_EVENTS.INFO.WIDGET.WIDGET_CREATED,
);
respondForbidden(res, data, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
const prose = "respondSuccess(res, data, 'RAW')";
void prose;
// respondForbidden(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED)
`,
    });
    const events = messages(root, 'd1:response-events').join('\n');
    assert.match(events, /respondSuccess takes a raw string event/);
    assert.match(events, /respondBadRequest takes a raw string event/);
    assert.equal((events.match(/raw string event/g) ?? []).length, 2);
    const order = messages(root, 'd1:respond-arg-order');
    assert.equal(order.length, 1);
    assert.match(order[0] ?? '', /payload slot/);
  });

  void it('follows responder aliases and ignores lookalikes, prose, and local functions', () => {
    const root = tree({
      'web-1/src/application/http/sample.ts': `import { respondSuccess as done, respondBadRequest as bad, respondForbidden as deny } from '@app/http/http.responses.utils';
import * as http from '@app/http/http.responses.utils';
const finished = done;
finished(res, data, 'RAW');
bad(res, 'ALSO_RAW');
const refuse = http.respondUnauthorized;
refuse(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
const { respondForbidden: block } = http;
block(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
deny(res, data, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
http.respondForbidden(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
function nested(res: unknown) {
  const deny = (a: unknown, b: unknown) => b;
  deny(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
  function respondSuccess(a: unknown, b: unknown, event: unknown) { return event; }
  respondSuccess(res, data, 'HIDDEN');
}
const prose = "done(res, data, 'RAW')";
void prose;
// deny(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED)
`,
      'web-1/src/application/http/lookalike.ts': `import { respondSuccess as done } from './fake-http.responses.utils';
import { respondForbidden as deny } from '@app/http/fake/http.responses.utils';
done(res, data, 'RAW');
deny(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
function respondForbidden(res: unknown, data: unknown) { return data; }
respondForbidden(res, APP_EVENTS.INFO.WIDGET.WIDGET_CREATED);
`,
    });
    const events = messages(root, 'd1:response-events');
    assert.equal(
      events.filter(message => message.includes('raw string')).length,
      2
    );
    assert.match(events.join('\n'), /respondSuccess takes a raw string event/);
    assert.match(
      events.join('\n'),
      /respondBadRequest takes a raw string event/
    );
    const order = messages(root, 'd1:respond-arg-order');
    assert.equal(order.length, 3);
    assert.ok(order.every(message => message.includes('payload slot')));
  });

  void it('rejects a string passed to a bound ok() and ignores a shadowed parameter', () => {
    const root = tree({
      'web-1/src/pages/api/v1/widget/create/index.ts': `import { defineEndpoint } from '@app/http/define-endpoint';
export default defineEndpoint(WIDGET_CONTRACTS.WIDGET_CREATE, {
  handle: (scope) => {
    scope.ok(data, 'RAW');
    const inner = (ok: (a: unknown, b: unknown) => void) => ok(data, 'HIDDEN');
    void inner;
  },
});
`,
    });
    const events = messages(root, 'd1:response-events');
    assert.equal(events.length, 1);
    assert.match(events[0] ?? '', /ok\/created takes a raw string event 'RAW'/);
  });

  void it('rejects an audit event that the policy gate would drop', () => {
    const root = tree({
      '.shared-kernel/domain/widget/widget.contracts.ts': `export const WIDGET_CONTRACTS = defineContracts({
        WIDGET_CREATE: {
          kind: 'COMMAND', path: 'widget/create', method: 'POST', body: z.object({}), query: null,
          access: 'PUBLIC', authCheck: true, limiterTier: 'default', group: 'WIDGET',
          successEvents: ['WIDGET_CREATED'], auditEvents: ['NOT_REGISTERED'],
        },
      });
`,
      '.shared-kernel/domain/email/email-schedule.config.ts':
        "export const EMAIL_SCHEDULE = { infoEvent: 'ALSO_MISSING' };\n",
      'web-1/src/application/email-handler/email-transactional.ts': `recordAuditEvent_IO({ eventName: 'THIRD_MISSING' });
recordAuditEvent_IO({ eventName: APP_EVENTS.INFO.WIDGET.WIDGET_CREATED });
sendTransactionalEmail(templateId, user, 'FOURTH_MISSING');
recordAuditEvent_IO({ eventName: dynamicName });
`,
    });
    const text = messages(root, 'd1:event-log').join('\n');
    assert.match(text, /NOT_REGISTERED/);
    assert.match(text, /ALSO_MISSING/);
    assert.match(text, /THIRD_MISSING/);
    assert.match(text, /WIDGET_CREATED/);
    assert.match(text, /FOURTH_MISSING/);
    assert.doesNotMatch(text, /dynamicName/);
  });

  void it('flags an INFO event that exists only in its registry, not one mentioned in a comment', () => {
    const only = tree({
      '.shared-kernel/domain/events/app-events.const.ts': `export const APP_EVENTS = {
      COMMANDS: { WIDGET: { WIDGET_CREATE: 'WIDGET_CREATE' } },
      QUERIES: {},
      CONFIRMATIONS: {},
      INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED', ONLY_HERE: 'ORPHAN_EVENT' } },
    };
`,
    });
    assert.match(messages(only, 'd1:info-orphans').join('\n'), /ORPHAN_EVENT/);
    const mentioned = tree({
      '.shared-kernel/domain/events/app-events.const.ts': `export const APP_EVENTS = {
      COMMANDS: { WIDGET: { WIDGET_CREATE: 'WIDGET_CREATE' } },
      QUERIES: {},
      CONFIRMATIONS: {},
      INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED', ONLY_HERE: 'ORPHAN_EVENT' } },
    };
`,
      'web-1/src/application/http/note.ts':
        "// the sweep still recognises 'ORPHAN_EVENT'\n",
    });
    assert.doesNotMatch(
      messages(mentioned, 'd1:info-orphans').join('\n'),
      /ORPHAN_EVENT/
    );
  });

  void it('rejects a hardcoded event string in EVENTS', () => {
    const root = tree({
      '.shared-kernel/domain/commands-and-queries/cqrs.config.ts': `export const EVENTS = Object.freeze({
  COMMANDS: { WIDGET: ['HARDCODED_EVENT'] },
});
`,
    });
    assert.match(
      messages(root, 'd1:info-orphans').join('\n'),
      /hardcoded event string 'HARDCODED_EVENT'/
    );
  });

  void it('rejects a missing grant and a grant on the wrong layer, and a comment is not a grant', () => {
    const missing = tree({
      '.shared-kernel/application/role-permissions.ts': `export const BASE_PERMISSIONS = [
  // APP_EVENTS.COMMANDS.WIDGET.WIDGET_CREATE
] as const;
export const LOGGED_USER_PERMISSIONS = [] as const;
export const STYLIST_SPECIFIC_PERMISSIONS = [] as const;
export const CLIENT_SPECIFIC_PERMISSIONS = [] as const;
`,
    });
    assert.match(
      messages(missing, 'd1:permissions').join('\n'),
      /missing from BASE_PERMISSIONS/
    );
    const wrong = tree({
      '.shared-kernel/domain/widget/widget.contracts.ts': `export const WIDGET_CONTRACTS = defineContracts({
        WIDGET_CREATE: {
          kind: 'COMMAND', path: 'widget/create', method: 'POST', body: z.object({}), query: null,
          access: 'STYLIST', authCheck: true, limiterTier: 'default', group: 'WIDGET',
          successEvents: ['WIDGET_CREATED'], auditEvents: ['WIDGET_AUDITED'],
        },
      });
`,
    });
    const text = messages(wrong, 'd1:permissions').join('\n');
    assert.match(text, /also grants it/);
    assert.match(text, /missing from STYLIST_SPECIFIC_PERMISSIONS/);
  });

  void it('rejects an admin-only increase and a seed without the wildcard', () => {
    const events = (count: number): string => {
      const fields = Array.from(
        { length: count },
        (_, index) => `EXTRA_${index}: 'EXTRA_${index}'`
      ).join(', ');
      return `export const APP_EVENTS = {
      COMMANDS: { WIDGET: { WIDGET_CREATE: 'WIDGET_CREATE', ${fields} } },
      QUERIES: {},
      CONFIRMATIONS: {},
      INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED' } },
    };
`;
    };
    const grown = tree({
      '.shared-kernel/domain/events/app-events.const.ts': events(
        ADMIN_ONLY_BASELINE + 1
      ),
    });
    assert.match(
      messages(grown, 'd1:permissions').join('\n'),
      new RegExp(
        `admin-only events increased: ${ADMIN_ONLY_BASELINE + 1} > baseline ${ADMIN_ONLY_BASELINE}`
      )
    );
    const exact = tree({
      '.shared-kernel/domain/events/app-events.const.ts':
        events(ADMIN_ONLY_BASELINE),
    });
    assert.doesNotMatch(
      messages(exact, 'd1:permissions').join('\n'),
      /admin-only events increased/
    );
    const seed = tree({
      'web-1/src/application/permissions/permissions.seed.ts': `export const ROLES = {
  [SystemRoleId.MASTER_ADMIN]: [],
};
`,
    });
    assert.match(
      messages(seed, 'd1:permissions').join('\n'),
      /does not call getAllEvents/
    );
  });

  void it('counts a public no-grant operation only when its auth bypass is invalid', () => {
    const fields = Array.from(
      { length: ADMIN_ONLY_BASELINE + 1 },
      (_, index) => `EXTRA_${index}: 'EXTRA_${index}'`
    ).join(', ');
    for (const authCheck of [false, true]) {
      const fixture = tree({
        '.shared-kernel/domain/events/app-events.const.ts': `export const APP_EVENTS = {
          COMMANDS: { WIDGET: { WIDGET_CREATE: 'WIDGET_CREATE', ${fields} } },
          QUERIES: {}, CONFIRMATIONS: {},
          INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED' } },
        };`,
        '.shared-kernel/domain/widget/widget.contracts.ts': `export const WIDGET_CONTRACTS = defineContracts({
          EXTRA_0: {
            kind: 'COMMAND', path: 'widget/public', method: 'POST', body: z.object({}), query: null,
            access: 'PUBLIC_NO_GRANT', authCheck: ${authCheck}, limiterTier: 'default', group: 'WIDGET',
            successEvents: ['WIDGET_CREATED'], auditEvents: [],
          },
        });`,
      });
      const text = messages(fixture, 'd1:permissions').join('\n');
      if (authCheck) {
        assert.match(text, /admin-only events increased/);
      } else {
        assert.doesNotMatch(text, /admin-only events increased/);
      }
    }
  });

  void it('rejects a sensitive default-tier route that is neither strict nor baselined', () => {
    const contract = `export const WIDGET_CONTRACTS = defineContracts({
      USER_EXPORT_DATA: {
        kind: 'COMMAND', path: 'widget/export-data', method: 'POST', body: z.object({}), query: null,
        access: 'PUBLIC', authCheck: true, limiterTier: 'default', group: 'WIDGET',
        successEvents: ['WIDGET_CREATED'], auditEvents: ['WIDGET_AUDITED'],
      },
    });
`;
    const chain = {
      '.shared-kernel/domain/widget/widget.contracts.ts': contract,
      '.shared-kernel/domain/events/app-events.const.ts': `export const APP_EVENTS = {
        COMMANDS: { WIDGET: { USER_EXPORT_DATA: 'USER_EXPORT_DATA' } },
        QUERIES: {}, CONFIRMATIONS: {},
        INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED' } },
      };
`,
      '.shared-kernel/domain/routing/routing.config.ts': `import { API_VER } from '../http/http.config';
export const ROUTES_API = Object.freeze({ USER_EXPORT_DATA: \`\${API_VER}widget/export-data\` });
`,
      '.shared-kernel/domain/http/http-methods.config.ts':
        "export const API_HTTP_METHODS = Object.freeze({ USER_EXPORT_DATA: 'POST' });\n",
      '.shared-kernel/application/role-permissions.ts': `export const BASE_PERMISSIONS = [
  APP_EVENTS.COMMANDS.WIDGET.USER_EXPORT_DATA,
] as const;
export const LOGGED_USER_PERMISSIONS = [] as const;
export const STYLIST_SPECIFIC_PERMISSIONS = [] as const;
export const CLIENT_SPECIFIC_PERMISSIONS = [] as const;
`,
      '.shared-kernel/models/widget/widget.dto.ts': `export type WIDGET_DTO_API_V1 = {
  USER_EXPORT_DATA: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X; IO_CLIENT_FUNCTION: X };
};
`,
      'web-1/src/pages/api/v1/widget/create/index.ts':
        '// unbound on purpose\n',
      'web-1/src/pages/api/v1/widget/export-data/index.ts': `import { defineEndpoint } from '@app/http/define-endpoint';
export default defineEndpoint(WIDGET_CONTRACTS.USER_EXPORT_DATA, { handle: () => undefined });
`,
    };
    assert.match(
      messages(tree(chain), 'd1:rate-limit').join('\n'),
      /USER_EXPORT_DATA matches the sensitive keyword set/
    );
    const strict = tree({
      ...chain,
      '.shared-kernel/domain/widget/widget.contracts.ts': contract.replace(
        "limiterTier: 'default'",
        "limiterTier: 'strict'"
      ),
      'web-1/src/application/http/rate-limit.middleware.ts': `export const RATE_LIMIT_CONFIG = {
  STRICT_ENDPOINTS: ['/api/auth/'],
};
`,
    });
    const strictText = messages(strict, 'd1:rate-limit').join('\n');
    assert.match(strictText, /not in the strict-routes region/);
    assert.doesNotMatch(strictText, /sensitive keyword set/);
  });

  void it('accepts a sensitive route covered by a strict prefix or the file baseline', () => {
    const contract = `export const WIDGET_CONTRACTS = defineContracts({
      USER_EXPORT_DATA: {
        kind: 'COMMAND', path: 'user/export-data', method: 'POST', body: z.object({}), query: null,
        access: 'PUBLIC', authCheck: true, limiterTier: 'default', group: 'WIDGET',
        successEvents: ['WIDGET_CREATED'], auditEvents: ['WIDGET_AUDITED'],
      },
    });
`;
    const covered = tree({
      '.shared-kernel/domain/widget/widget.contracts.ts': contract.replace(
        "path: 'user/export-data'",
        "path: 'widget/export-data'"
      ),
      '.shared-kernel/domain/events/app-events.const.ts': `export const APP_EVENTS = {
        COMMANDS: { WIDGET: { USER_EXPORT_DATA: 'USER_EXPORT_DATA' } },
        QUERIES: {}, CONFIRMATIONS: {},
        INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED' } },
      };
`,
      '.shared-kernel/domain/routing/routing.config.ts': `import { API_VER } from '../http/http.config';
export const ROUTES_API = Object.freeze({ USER_EXPORT_DATA: \`\${API_VER}widget/export-data\` });
`,
      '.shared-kernel/domain/http/http-methods.config.ts':
        "export const API_HTTP_METHODS = Object.freeze({ USER_EXPORT_DATA: 'POST' });\n",
      '.shared-kernel/application/role-permissions.ts': `export const BASE_PERMISSIONS = [
  APP_EVENTS.COMMANDS.WIDGET.USER_EXPORT_DATA,
] as const;
export const LOGGED_USER_PERMISSIONS = [] as const;
export const STYLIST_SPECIFIC_PERMISSIONS = [] as const;
export const CLIENT_SPECIFIC_PERMISSIONS = [] as const;
`,
      '.shared-kernel/models/widget/widget.dto.ts': `export type WIDGET_DTO_API_V1 = {
  USER_EXPORT_DATA: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X; IO_CLIENT_FUNCTION: X };
};
`,
      'web-1/src/pages/api/v1/widget/create/index.ts': '// unbound\n',
      'web-1/src/pages/api/v1/widget/export-data/index.ts': `import { defineEndpoint } from '@app/http/define-endpoint';
export default defineEndpoint(WIDGET_CONTRACTS.USER_EXPORT_DATA, { handle: () => undefined });
`,
      'web-1/src/application/http/rate-limit.middleware.ts': `export const RATE_LIMIT_CONFIG = {
  STRICT_ENDPOINTS: ['/api/v1/widget/'],
};
`,
    });
    assert.deepEqual(messages(covered, 'd1:rate-limit'), []);
  });

  void it('rejects a CQRS event with no DTO block and a block missing a field', () => {
    const missing = tree({
      '.shared-kernel/models/widget/widget.dto.ts':
        'export type WIDGET_DTO_API_V1 = {};\n',
    });
    assert.match(
      messages(missing, 'd1:dto-ops').join('\n'),
      /WIDGET_CREATE has no DTO block/
    );
    const partial = tree({
      '.shared-kernel/models/widget/widget.dto.ts': `export type WIDGET_DTO_API_V1 = {
  WIDGET_CREATE: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X };
};
`,
    });
    assert.match(
      messages(partial, 'd1:dto-ops').join('\n'),
      /missing IO_CLIENT_FUNCTION/
    );
  });

  void it('reads access from a same-file spread and a DTO joined by intersection', () => {
    const root = tree({
      '.shared-kernel/domain/widget/widget.contracts.ts': `const ADMIN = { access: 'ADMIN' as const, authCheck: true as const, limiterTier: 'default' as const, group: 'WIDGET' as const };
export const WIDGET_CONTRACTS = defineContracts({
  WIDGET_CREATE: {
    ...ADMIN,
    kind: 'COMMAND', path: 'widget/create', method: 'POST', body: z.object({}), query: null,
    successEvents: ['WIDGET_CREATED'], auditEvents: ['WIDGET_AUDITED'],
  },
});
`,
      '.shared-kernel/models/widget/widget.dto.ts': `export type WIDGET_EXTRA = {
  WIDGET_CREATE: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X; IO_CLIENT_FUNCTION: X };
};
export type WIDGET_DTO_API_V1 = {} & WIDGET_EXTRA;
`,
    });
    assert.doesNotMatch(
      messages(root, 'd1:permissions').join('\n'),
      /unknown access/
    );
    assert.deepEqual(messages(root, 'd1:dto-ops'), []);
  });

  void it('follows a valid route alias to the host DTO and rejects a dangling alias', () => {
    const events = `export const APP_EVENTS = {
      COMMANDS: { WIDGET: { WIDGET_CREATE: 'WIDGET_CREATE' }, USER: { USER_LOGOUT: 'USER_LOGOUT', ORPHAN_OP: 'ORPHAN_OP' } },
      QUERIES: {},
      CONFIRMATIONS: {},
      INFO: { WIDGET: { WIDGET_CREATED: 'WIDGET_CREATED' } },
    };
`;
    const routes = `import { API_VER } from '../http/http.config';
export const ROUTES_API = Object.freeze({
  WIDGET_CREATE: \`\${API_VER}widget/create\`,
  SESSION_DELETE_ALL: \`\${API_VER}session/delete/all\`,
});
`;
    const dto = `export type WIDGET_DTO_API_V1 = {
  WIDGET_CREATE: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X; IO_CLIENT_FUNCTION: X };
  SESSION_DELETE_ALL: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X; IO_CLIENT_FUNCTION: X };
};
`;
    const shared = {
      '.shared-kernel/domain/events/app-events.const.ts': events,
      '.shared-kernel/domain/routing/routing.config.ts': routes,
      '.shared-kernel/models/widget/widget.dto.ts': dto,
    };
    const ok = tree({
      ...shared,
      'main/src/application/http/http.endpoints.ts':
        "const ROUTE_ALIASES = { USER_LOGOUT: 'SESSION_DELETE_ALL' };\n",
    });
    const dtoOk = messages(ok, 'd1:dto-ops').join('\n');
    assert.match(dtoOk, /ORPHAN_OP has no DTO block/);
    assert.doesNotMatch(dtoOk, /USER_LOGOUT/);
    assert.doesNotMatch(
      messages(ok, 'd1:registries').join('\n'),
      /USER_LOGOUT/
    );
    const thin = tree({
      ...shared,
      '.shared-kernel/domain/events/app-events.const.ts': events.replace(
        ", ORPHAN_OP: 'ORPHAN_OP'",
        ''
      ),
      '.shared-kernel/models/widget/widget.dto.ts': `export type WIDGET_DTO_API_V1 = {
  WIDGET_CREATE: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X; IO_CLIENT_FUNCTION: X };
  SESSION_DELETE_ALL: { REQUEST: X; RESPONSE: X; RESPONSE_ERROR: X };
};
`,
      'main/src/application/http/http.endpoints.ts':
        "const ROUTE_ALIASES = { USER_LOGOUT: 'SESSION_DELETE_ALL' };\n",
    });
    assert.match(
      messages(thin, 'd1:dto-ops').join('\n'),
      /USER_LOGOUT aliases SESSION_DELETE_ALL, whose DTO block is missing IO_CLIENT_FUNCTION/
    );
    const dangling = tree({
      ...shared,
      '.shared-kernel/domain/events/app-events.const.ts': events.replace(
        ", ORPHAN_OP: 'ORPHAN_OP'",
        ''
      ),
      'main/src/application/http/http.endpoints.ts':
        "const ROUTE_ALIASES = { USER_LOGOUT: 'GONE' };\n",
    });
    assert.match(
      messages(dangling, 'd1:dto-ops').join('\n'),
      /USER_LOGOUT aliases GONE but GONE has no DTO block/
    );
    assert.match(
      messages(dangling, 'd1:registries').join('\n'),
      /alias USER_LOGOUT → GONE but ROUTES_API has no GONE/
    );
  });

  void it('reads POST from the factory a raw webhook delegates to', () => {
    const root = tree({
      '.shared-kernel/application/contracts/raw-protocols.ts': `export const RAW_PROTOCOLS = [
  { id: 'WEBHOOK_MAILGUN', file: 'v1/webhooks/mailgun/index.ts', methods: ['POST'], access: 'provider', reason: 'raw body' },
];
`,
      'web-1/src/pages/api/v1/internal/health-public/index.ts':
        '// not this protocol\n',
      'web-1/src/application/email-handler/lifecycle/delivery-webhook-handler.ts':
        "export const lifecycleWebhookHandler = (provider: string) => withPublicHandler({ allowedMethods: ['POST'], handle: () => undefined });\n",
      'web-1/src/pages/api/v1/webhooks/mailgun/index.ts': `import { lifecycleWebhookHandler } from '@app/email-handler/lifecycle/delivery-webhook-handler';
export default lifecycleWebhookHandler('mailgun');
`,
    });
    assert.doesNotMatch(messages(root, 'd1:bindings').join('\n'), /mailgun/);
  });

  void it('follows a 4-module admin aggregate and imported DTO parts without executing them', () => {
    const root = tree(adminSplit());
    assert.equal(one(root, 'd1:contract-shape').sites, 7);
    assert.deepEqual(messages(root, 'd1:contract-shape'), []);
    assert.deepEqual(messages(root, 'd1:permissions'), []);
    const dto = messages(root, 'd1:dto-ops').join('\n');
    assert.match(dto, /DECOY_OP has no DTO block/);
    assert.doesNotMatch(
      dto,
      /SEND_LOG|BECOME_USER|TIE|ADMIN_BULK_DISABLE|ADMIN_GET_PERMISSIONS|ADMIN_GET_EMAIL_HISTORY/
    );
  });

  void it('rejects a missing event and an unregistered map, not a fake spread or a suffix', () => {
    const root = tree(adminSplit({ rogue: true }));
    const shape = messages(root, 'd1:contract-shape').join('\n');
    assert.match(
      shape,
      /NOT_IN_EVENTS is not a COMMAND, QUERY or CONFIRMATION event/
    );
    assert.match(
      shape,
      /ADMIN_ROGUE is not referenced by api-contracts\.registry\.ts/
    );
    assert.doesNotMatch(shape, /ADMIN_COMMAND_|ADMIN_QUERY_/);
    assert.doesNotMatch(shape, /FAKE_OP|GHOST_OP|COMMENT_OP|STRING_OP/);
  });

  void it('rejects an admin operation granted on the public layer', () => {
    const root = tree(adminSplit({ grant: true }));
    const text = messages(root, 'd1:permissions').join('\n');
    assert.match(
      text,
      /ADMIN_GET_EMAIL_HISTORY is ADMIN but BASE_PERMISSIONS also grants it \(APP_EVENTS\.QUERIES\.ADMIN\.ADMIN_GET_EMAIL_HISTORY\)/
    );
    assert.doesNotMatch(text, /unknown access/);
    assert.deepEqual(messages(root, 'd1:contract-shape'), []);
  });

  void it('is an error when an anchor file is missing', () => {
    const root = tree();
    rmSync(path.join(root, '.shared-kernel/domain/events/app-events.const.ts'));
    const anchor = one(root, 'd1:anchors');
    assert.match(anchor.errors.join('\n'), /app-events\.const\.ts/);
    assert.equal(run(root, {}).length, 1);
  });
});
