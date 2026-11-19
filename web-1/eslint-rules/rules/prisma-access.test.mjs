// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import guard from './prisma-access.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const W = '/w';
const app = `${W}/src/application/foo/bar.ts`;
const adapter = `${W}/src/application/db/adapters/prisma.adapter.ts`;
const dbClient = `${W}/src/application/db/db.client.ts`;

// A workspace that HAS src/infrastructure, for the directory check reported on the adapter.
const withInfra = mkdtempSync(path.join(os.tmpdir(), 'nf-prisma-access-'));
mkdirSync(path.join(withInfra, 'src/infrastructure'), { recursive: true });
afterAll(() => rmSync(withInfra, { recursive: true, force: true }));

const runtimeImport = [{ messageId: 'runtimeImport' }];
const construct = [{ messageId: 'construct' }];

tester.run('nf/prisma-access', guard.rule, {
  valid: [
    // the adapter is the one place
    {
      filename: adapter,
      code: "import { PrismaClient } from '../../../prisma/js-client';\nexport const c = new PrismaClient();",
    },
    {
      filename: dbClient,
      code: "import { DB_CLIENT_PRISMA } from './adapters/prisma.adapter';\nexport const DB_CLIENT = DB_CLIENT_PRISMA;",
    },
    // type-only imports and the runtime Prisma namespace
    {
      filename: app,
      code: "import type { Prisma, PrismaClient } from '../../prisma/js-client';\ntype X = PrismaClient | Prisma.JsonValue;",
    },
    {
      filename: app,
      code: "import { type PrismaClient, Prisma } from '../../prisma/js-client';\nconst q = Prisma.sql`select 1`;",
    },
    {
      filename: app,
      code: "import type * as Client from '../../prisma/js-client';\ntype X = Client.PrismaClient;",
    },
    {
      filename: app,
      code: "import type { DB_CLIENT_PRISMA } from '../db/adapters/prisma.adapter';",
    },
    // other constructors, prose
    {
      filename: app,
      code: 'const m = new Map();\nclass PrismaClientLike {}\nconst x = new PrismaClientLike();',
    },
    {
      filename: app,
      code: '// new PrismaClient()\n/* import { PrismaClient } from "../../prisma/js-client" */\nconst s = "new PrismaClient()";\nconst t = `new PrismaClient()`;',
    },
    // declaration files stay out (generated doc comments)
    {
      filename: `${W}/src/types/prisma.d.ts`,
      code: "import { PrismaClient } from '../prisma/js-client';",
    },
  ],
  invalid: [
    {
      filename: app,
      code: "import { PrismaClient } from '../../prisma/js-client';\nconst c = new PrismaClient();",
      errors: [...runtimeImport, ...construct],
    },
    {
      filename: app,
      code: "import {\n  Prisma,\n  PrismaClient,\n} from '../../prisma/js-client';",
      errors: runtimeImport,
    },
    {
      filename: app,
      code: "import { PrismaClient as C } from '../../prisma-app-logs/js-client';\nconst c = new C();",
      errors: [...runtimeImport, ...construct],
    },
    {
      filename: app,
      code: "import { PrismaClient } from '@prisma/client';",
      errors: runtimeImport,
    },
    {
      filename: app,
      code: "import * as Client from '../../prisma/js-client';\nconst c = new Client.PrismaClient();",
      errors: [...runtimeImport, ...construct],
    },
    {
      filename: app,
      code: "export { PrismaClient } from '../../prisma/js-client';",
      errors: runtimeImport,
    },
    {
      filename: app,
      code: "const { PrismaClient } = require('../../prisma/js-client');\nconst c = new PrismaClient();",
      errors: [...runtimeImport, ...construct],
    },
    {
      filename: app,
      code: "const m = await import('../../prisma/js-client');",
      errors: runtimeImport,
    },
    // an undeclared global of that name, as the grep read it
    { filename: app, code: 'const c = new PrismaClient();', errors: construct },
    {
      filename: app,
      code: 'declare const C: any;\nconst Ctor = PrismaClient;\nconst c = new Ctor();',
      errors: construct,
    },
    // adapter reached around DB_CLIENT
    {
      filename: app,
      code: "import { DB_CLIENT_PRISMA } from '../db/adapters/prisma.adapter';",
      errors: [{ messageId: 'adapterImport' }],
    },
    {
      filename: app,
      code: "import { DB_CLIENT_PRISMA } from '@app/db/adapters/prisma.adapter';",
      errors: [{ messageId: 'adapterImport' }],
    },
    // D1: no infrastructure layer
    {
      filename: `${W}/src/infrastructure/user.repository.ts`,
      code: 'export const r = 1;',
      errors: [{ messageId: 'infrastructure' }],
    },
    {
      filename: path.join(
        withInfra,
        'src/application/db/adapters/prisma.adapter.ts'
      ),
      code: 'export const a = 1;',
      errors: [{ messageId: 'infrastructure' }],
    },
  ],
});
