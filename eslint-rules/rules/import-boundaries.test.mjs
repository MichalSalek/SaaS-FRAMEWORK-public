// @vitest-environment node
// Byte-identical in main/, web-1/ and the root: the options of all three workspaces come from the
// rule module's BLOCKS table, so every workspace's suite proves every workspace's bans.
import guard, { BLOCKS } from './import-boundaries.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const MAIN = [BLOCKS.main[0].options];
const WEB = [BLOCKS['web-1'][0].options];
const KERNEL = [BLOCKS.root[0].options];

const at = (filename, options) => ({
  ok: code => ({ code, filename, options }),
  bad: (code, messageId = 'ban', count = 1) => ({
    code,
    filename,
    options,
    errors: Array.from({ length: count }, () => ({ messageId })),
  }),
});
const main = at('src/domain/x.ts', MAIN);
const component = at('src/UI/components/Card/Card.molecule.ts', MAIN);
const web = at('src/domain/email/x.ts', WEB);
const kernel = at('.shared-kernel/domain/x.ts', KERNEL);

tester.run('nf/import-boundaries', guard.rule, {
  valid: [
    // fixture must-pass/comment-only: prose naming the other app
    main.ok('/** return values from async tasks; the web-1 counterpart does the same. */\nexport const fixture = 1;'),
    // prose and strings are not specifiers
    main.ok("// import x from '../../web-1/src/x';\nconst s = 'web-1/src/x';\nconst t = `../features/${s}`;"),
    // the shell guard read this line as a cross-module import
    main.ok("import { a } from './a'; const s = 'web-1';"),
    main.ok("import { TIME } from '@kernel/application/constants.config';\nimport { a } from '../application/a';"),
    main.ok("import x from '@kernel/models/db_models.generated.dto';"),
    // components may import components and the application layer
    component.ok("import { Button } from '../Button/Button.atom';\nimport { useX } from '../../../application/x';"),
    // escape with a reason, on the line or the line above
    component.ok("import { Bell } from '../../features/notifications/Bell'; // features-import-allow: shared bell until moved"),
    component.ok("// features-import-allow: shared bell until moved\nimport { Bell } from '../../features/notifications/Bell';"),
    // the same import outside components/ is fine
    at('src/UI/features/a/A.ts', MAIN).ok("import { B } from '../b/B';"),
    // web-1: Prisma / PrismaClient from the js-client, value or type
    web.ok("import type { Prisma } from '../../prisma/js-client';"),
    web.ok("import { Prisma, PrismaClient } from '../../prisma/js-client';"),
    web.ok("import { sendEmail } from '@app/email-handler/email-transport';"),
    web.ok("import { getStripe } from '@app/stripe/adapters/stripe.adapter';"),
    // the facade, the Better Auth hook and the adapters themselves
    at('src/application/email-handler/email-transport.ts', WEB).ok("import { sendEmail } from './adapters/mailgun';"),
    at('src/application/auth/better-auth/better-auth.config.ts', WEB).ok(
      "import { sendVerificationRequest } from '@app/email-handler/adapters/magic-link.adapter';"
    ),
    at('src/application/email-handler/adapters/resend.ts', WEB).ok("import { x } from './mailgun';"),
    // a path that merely contains "main" as a word
    web.ok("import { mainThing } from '@domain/maintenance/x';"),
    // kernel: relative inside the kernel, packages
    kernel.ok("import { z } from 'zod';\nimport { V } from '../i18n/validation.i18n';"),
  ],
  invalid: [
    // fixture must-fail/cross-module: require() of the other app, outside the workspace
    {
      code: "declare const require: (path: string) => unknown;\nexport const fixture = require('../../web-1/src/fixture');",
      filename: 'src/fixture.ts',
      options: MAIN,
      errors: [{ messageId: 'escape' }, { messageId: 'ban' }],
    },
    main.bad("import { x } from 'web-1/src/x';"),
    {
      code: "const m = await import('../../../web-1/src/x');",
      filename: 'src/domain/x.ts',
      options: MAIN,
      errors: [{ messageId: 'escape' }, { messageId: 'ban' }],
    },
    {
      code: "export { x } from '../../../web-1/src/x';",
      filename: 'src/domain/x.ts',
      options: MAIN,
      errors: [{ messageId: 'escape' }, { messageId: 'ban' }],
    },
    // a multi-line import the line grep could not see as one
    {
      code: "import {\n  a,\n  b,\n} from '../../../web-1/src/x';",
      filename: 'src/domain/x.ts',
      options: MAIN,
      errors: [{ messageId: 'escape' }, { messageId: 'ban' }],
    },
    {
      code: "import { y } from '../../../../main/src/y';",
      filename: 'src/domain/email/x.ts',
      options: WEB,
      errors: [{ messageId: 'escape' }, { messageId: 'ban' }],
    },
    // an escape that names no app
    web.bad("import pkg from '../../../../package.json';", 'escape'),
    {
      code: "vi.mock('../../../../main/src/y');",
      filename: 'src/domain/email/x.ts',
      options: WEB,
      errors: [{ messageId: 'escape' }, { messageId: 'ban' }],
    },
    main.bad("import x from '@kernel/models/db_models.dto';"),
    // reverse layer: static, dynamic, index, alias-free relative
    component.bad("import { Bell } from '../../features/notifications/Bell';"),
    component.bad("const B = () => import('../../features/notifications/Bell');"),
    component.bad("import { all } from '../../features';"),
    component.bad("export { Bell } from '../../features/notifications/Bell';"),
    component.bad("// features-import-allow\nimport { Bell } from '../../features/notifications/Bell';", 'bareMarker'),
    component.bad("import { Bell } from '../../features/notifications/Bell'; // features-import-allow:", 'bareMarker'),
    // web-1 Prisma SSOT
    web.bad("import { UserRole } from '../../prisma/js-client';"),
    web.bad("import { Prisma, UserRole } from '../../prisma/js-client';"),
    web.bad("import { Prisma as P } from '../../prisma/js-client';"),
    web.bad("import * as client from '../../prisma/js-client';"),
    web.bad("export { UserRole } from '../../prisma/js-client';"),
    web.bad("import '../../prisma/js-client';"),
    web.bad("const c = require('../../prisma/js-client');"),
    // email transport facade
    web.bad("import { sendEmail } from '@app/email-handler/adapters/mailgun';"),
    web.bad("import { sendEmail } from '../../application/email-handler/adapters/resend';"),
    at('src/application/email-handler/newsletter.ts', WEB).bad("import { x } from './adapters/resend';"),
    // kernel
    {
      code: "import { x } from '../../main/src/READONLY-shared-kernel/x';",
      filename: '.shared-kernel/domain/x.ts',
      options: KERNEL,
      errors: [{ messageId: 'escape' }, { messageId: 'ban' }],
    },
    kernel.bad("import { x } from './READONLY-shared-kernel/x';"),
    kernel.bad("import type { T } from '../models/db_models.dto';"),
    kernel.bad("type T = import('../../web-1/src/x').T;", 'escape'),
  ],
});
