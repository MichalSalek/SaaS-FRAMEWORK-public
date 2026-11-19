// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import guard from './layout-consistency.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = path.join(WORKSPACE, 'src/pages/app/demo.tsx');
const feature = path.join(WORKSPACE, 'src/UI/features/demo/Demo.composition.tsx');
const tester = createRuleTester({ jsx: true });
const pageError = [{ messageId: 'pageImportsLayout' }];
const getLayout = [{ messageId: 'getLayout' }];

tester.run('nf/layout-consistency', guard.rule, {
  valid: [
    // the feature component mounts the layout (canon)
    { code: `import { AppLayoutComposition } from '../../layouts/AppLayout.composition';`, filename: feature },
    // a page may import non-primitive modules of the layouts root (_app.tsx shape)
    { code: `import { LeaveGuardDialogComposition } from '../UI/layouts/LeaveGuardDialog.composition';`, filename: page },
    { code: `const m = import('../UI/layouts/ImpersonationBanner.organism');`, filename: page },
    { code: `import { useAppRole } from '../../UI/layouts/useAppRole';`, filename: page },
    // a feature component imported by the page
    { code: `import { DemoComposition } from '../../UI/features/demo/Demo.composition';`, filename: page },
    // prose and strings never count
    { code: `// Page.getLayout = page => page\nconst a = 1;`, filename: page },
    { code: `/* import { AppLayoutComposition } from '../UI/layouts/AppLayout.composition' */\nconst a = 1;`, filename: page },
    { code: `const s = 'getLayout';`, filename: feature },
    { code: 'const s = `Page.getLayout`;', filename: feature },
  ],
  invalid: [
    // check 1: the script's shape (named import of a suffixed primitive)
    { code: `import { AppLayoutComposition } from '../../UI/layouts/AppLayout.composition';`, filename: page, errors: pageError },
    { code: `import { PublicLayoutComposition } from '../UI/layouts/PublicLayout.composition';`, filename: page, errors: pageError },
    { code: `import { AdminPageLayoutComposition } from '../../UI/layouts/AdminPageLayout.composition';`, filename: page, errors: pageError },
    // discovered primitive the hand list did not name
    { code: `import { AccountWebLayoutComposition } from '../../UI/layouts/AccountWebLayout.composition';`, filename: page, errors: pageError },
    // forms the named-import regex could not see
    { code: `import * as L from '../../UI/layouts/AppLayout.composition';`, filename: page, errors: pageError },
    { code: `import type { AppLayoutProps } from '../../UI/layouts/AppLayout.composition';`, filename: page, errors: pageError },
    { code: `export { AppLayoutComposition } from '../../UI/layouts/AppLayout.composition';`, filename: page, errors: pageError },
    { code: `const L = dynamic(() => import('../../UI/layouts/AdminLayout.composition'));`, filename: page, errors: pageError },
    { code: `import {\n  AppLayoutComposition,\n} from '@/UI/layouts';`, filename: page, errors: pageError },
    // check 2: getLayout anywhere in src
    { code: `Page.getLayout = page => page;`, filename: page, errors: getLayout },
    { code: `type P = { getLayout?: (p: unknown) => unknown };`, filename: feature, errors: getLayout },
    { code: `const x = Page['getLayout'];`, filename: feature, errors: getLayout },
    { code: `const { getLayout } = Component;`, filename: feature, errors: [...getLayout, ...getLayout] },
  ],
});
