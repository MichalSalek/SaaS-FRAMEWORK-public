// Tests for tools/auth-page-guard.ts: temp mini trees under os.tmpdir().
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  ALLOWLIST,
  checkAuthPageGuard,
  GUARDS,
  PAGES_ROOT,
} from './auth-page-guard';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Guard modules export their binding; allowlisted pages are plain redirect stubs. */
function base(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [rel, name] of Object.entries(GUARDS)) {
    files[rel] = name.startsWith('use')
      ? `export function ${name}(): { ok: boolean } { return { ok: true }; }\n`
      : `export function ${name}({ children }: { children?: unknown }): unknown { return children; }\n`;
  }
  for (const rel of Object.keys(ALLOWLIST)) {
    files[rel] = 'export default function Redirect(): null { return null; }\n';
  }
  return files;
}

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-auth-page-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries({ ...base(), ...files })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const PAGE = `${PAGES_ROOT}/thing/index.tsx`;
const FEATURE = 'main/src/UI/features/thing/ThingPage.composition.tsx';
const pageImporting = (spec: string, name = 'ThingPageComposition'): string =>
  `import { ${name} } from '${spec}';\nexport default function Page() { return <${name} />; }\n`;
const SPEC = '../../../UI/features/thing/ThingPage.composition';
const featureWith = (body: string): string =>
  `import { AppLayoutComposition } from '../../layouts/AppLayout.composition';\n${body}\n`;

const flagged = (check: CheckResult): string[] =>
  check.findings.map(f => f.file);

void describe('auth-page-guard', () => {
  void it('accepts a thin page whose feature composition renders the AppLayout shell', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: pageImporting(SPEC),
        [FEATURE]: featureWith(
          'export function ThingPageComposition() { return <AppLayoutComposition>x</AppLayoutComposition>; }'
        ),
      })
    );
    assert.deepEqual(flagged(c), []);
    assert.equal(c.sites, 3);
  });

  void it('rejects a page with no guard anywhere', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: pageImporting(SPEC),
        [FEATURE]:
          'export function ThingPageComposition() { return <div />; }\n',
      })
    );
    assert.deepEqual(flagged(c), [PAGE]);
  });

  void it('rejects a guard named only in a page comment (the shell guard accepted it)', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: `// Thin shell, the feature carries its own <AppLayout>.\n${pageImporting(SPEC)}`,
        [FEATURE]:
          'export function ThingPageComposition() { return <div />; }\n',
      })
    );
    assert.deepEqual(flagged(c), [PAGE]);
  });

  void it('rejects guard names in a string or template literal', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: pageImporting(SPEC),
        [FEATURE]:
          'export function ThingPageComposition() { return `AppLayoutComposition ${"useAppRole"}`; }\n',
      })
    );
    assert.deepEqual(flagged(c), [PAGE]);
  });

  void it('rejects a guard that is imported but never used', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: pageImporting(SPEC),
        [FEATURE]: featureWith(
          'export function ThingPageComposition() { return <div />; }'
        ),
      })
    );
    assert.deepEqual(flagged(c), [PAGE]);
  });

  void it('rejects a look-alike identifier not imported from a guard module', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: pageImporting(SPEC),
        [FEATURE]:
          'const AppLayoutComposition = (p: { children?: unknown }) => p.children;\nexport function ThingPageComposition() { return <AppLayoutComposition />; }\n',
      })
    );
    assert.deepEqual(flagged(c), [PAGE]);
  });

  void it('accepts an aliased guard import (alias)', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: pageImporting(SPEC),
        [FEATURE]:
          "import { AdminPageLayoutComposition as Shell } from '../../layouts/AdminPageLayout.composition';\nexport function ThingPageComposition() { return <Shell />; }\n",
      })
    );
    assert.deepEqual(flagged(c), []);
  });

  void it('accepts a guard hook called in the page itself', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]:
          "import { useAppRole } from '../../../UI/layouts/useAppRole';\nexport default function Page() { const r = useAppRole(); return <div>{String(r.ok)}</div>; }\n",
      })
    );
    assert.deepEqual(flagged(c), []);
  });

  void it('follows a directory module (barrel + component) and a dynamic import', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]:
          "import { Thing } from '../../../UI/features/thing';\nexport default function Page() { return <Thing />; }\n",
        'main/src/UI/features/thing/index.ts':
          "export { Thing } from './Thing';\n",
        'main/src/UI/features/thing/Thing.tsx': featureWith(
          'export function Thing() { return <AppLayoutComposition />; }'
        ),
        [`${PAGES_ROOT}/other/index.tsx`]:
          "import dynamic from 'next/dynamic';\nconst Other = dynamic(() => import('../../../UI/features/other/Other'));\nexport default function Page() { return <Other />; }\n",
        'main/src/UI/features/other/Other.tsx': featureWith(
          'export default function Other() { return <AppLayoutComposition />; }'
        ),
      })
    );
    assert.deepEqual(flagged(c), []);
  });

  void it('does not follow two levels (same depth as before)', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]: pageImporting(SPEC),
        [FEATURE]:
          "import { Inner } from '../inner/Inner';\nexport function ThingPageComposition() { return <Inner />; }\n",
        'main/src/UI/features/inner/Inner.tsx': featureWith(
          'export function Inner() { return <AppLayoutComposition />; }'
        ),
      })
    );
    assert.deepEqual(flagged(c), [PAGE]);
  });

  void it('does not count a guard in a test file of a directory module', () => {
    const c = checkAuthPageGuard(
      tree({
        [PAGE]:
          "import { Thing } from '../../../UI/features/thing';\nexport default function Page() { return <Thing />; }\n",
        'main/src/UI/features/thing/index.tsx':
          'export function Thing() { return <div />; }\n',
        'main/src/UI/features/thing/Thing.test.tsx': featureWith(
          'export const t = <AppLayoutComposition />;'
        ),
      })
    );
    assert.deepEqual(flagged(c), [PAGE]);
  });

  void it('flags an allowlisted page that now reaches a guard (dead exemption)', () => {
    const [first] = Object.keys(ALLOWLIST);
    assert.ok(first !== undefined);
    const c = checkAuthPageGuard(
      tree({
        [first]:
          "import { useRecoveryGuard } from '../../../UI/layouts/guards/useRecoveryGuard';\nexport default function P() { useRecoveryGuard(); return null; }\n",
      })
    );
    assert.deepEqual(flagged(c), [first]);
  });

  void it('is an error when a guard module stops exporting its binding', () => {
    const c = checkAuthPageGuard(
      tree({
        'main/src/UI/layouts/useAppRole.ts':
          'export const somethingElse = 1;\n',
      })
    );
    assert.match(c.errors.join(' '), /no longer exports useAppRole/);
  });

  void it('is an error when an allowlisted page is missing', () => {
    const root = tree({});
    const [first] = Object.keys(ALLOWLIST);
    assert.ok(first !== undefined);
    rmSync(path.join(root, first));
    assert.match(checkAuthPageGuard(root).errors.join(' '), /does not exist/);
  });
});
