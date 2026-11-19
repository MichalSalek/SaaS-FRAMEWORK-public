// Mutation proofs for d5-surface. A legal mini tree stays quiet; each injected miss is named.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';
import {
  checkBundleImports,
  checkComposePairs,
  checkDeployArtifact,
  checkDeployOrigin,
  checkLlmsDe,
  checkMainContent,
  checkProfileSeo,
  checkScrollReset,
  checkTestUsers,
  checkUiLibrary,
  run,
} from './d5-surface';
import { projectRoot, type CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-d5-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

const messages = (check: CheckResult): string[] =>
  check.findings.map(finding => finding.message);

const LAYOUT = (id: boolean, shell: boolean): string =>
  `export const L = () => (${id ? "<main id='main-content'>" : '<main>'}
    ${shell ? '<NavigationContentShellComposition />' : '<div />'}
  </main>);`;

void describe('d5-surface mutations', () => {
  void it('uses the target repository index when a parent hook exports Git context', () => {
    const root = tree({
      'main/src/UI/features/ui-library/uiLibrary.registry.ts':
        "export const rows = [{ importPath: 'src/UI/components/Button/Button.atom' }];\n",
      'main/src/UI/components/Button/Button.atom.tsx':
        'export const ButtonAtom = () => null;\n',
      'main/src/UI/components/Ghost/Ghost.atom.tsx':
        'export const GhostAtom = () => null;\n',
    });
    const setupEnv = { ...process.env };
    for (const key of Object.keys(setupEnv)) {
      if (key.startsWith('GIT_')) delete setupEnv[key];
    }
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, env: setupEnv, stdio: 'pipe' });
    };
    git('init', '.');
    mkdirSync(path.join(root, '.git/modules'), { recursive: true });
    git(
      'init',
      '--separate-git-dir',
      path.join(root, '.git/modules/main'),
      'main'
    );
    git('-C', 'main', 'add', 'src/UI/components/Button/Button.atom.tsx');
    const target = pathToFileURL(
      path.join(projectRoot(), 'tests/audit/tools/d5-surface.ts')
    ).href;
    const inspect = (context: NodeJS.ProcessEnv): CheckResult =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--import',
            import.meta.resolve('tsx/esm'),
            '--input-type=module',
            '-e',
            `import {checkUiLibrary} from ${JSON.stringify(target)}; console.log(JSON.stringify(checkUiLibrary(${JSON.stringify(root)})));`,
          ],
          {
            cwd: root,
            encoding: 'utf8',
            env: { ...setupEnv, ...context },
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
      ) as CheckResult;
    for (const context of [
      { GIT_INDEX_FILE: '.git/index' },
      {
        GIT_DIR: path.join(root, '.git'),
        GIT_WORK_TREE: root,
        GIT_COMMON_DIR: path.join(root, '.git'),
        GIT_INDEX_FILE: '.git/index',
        GIT_PREFIX: 'parent/',
      },
    ]) {
      const check = inspect(context);
      assert.deepEqual(check.errors, []);
      assert.deepEqual(check.findings, []);
      assert.equal(
        check.sites,
        1,
        'untracked WIP is not part of the tracked component census'
      );
    }
    git('-C', 'main', 'add', 'src/UI/components/Ghost/Ghost.atom.tsx');
    const broken = inspect({ GIT_INDEX_FILE: '.git/index' });
    assert.equal(broken.sites, 2);
    assert.ok(messages(broken).some(message => message.includes('Ghost')));
  });

  void it('rejects a profile page that posts or never renders JSON-LD', () => {
    const bad = tree({
      'main/src/pages/stylist/[identifier].tsx':
        "export const p = () => fetch(u, { method: 'POST' });\nimport { buildStylistProfileJsonLdItems } from './b';\n",
    });
    const messagesBad = messages(checkProfileSeo(bad));
    assert.ok(messagesBad.some(message => message.includes('POST')));
    assert.ok(messagesBad.some(message => message.includes('never called')));
    const good = tree({
      'main/src/pages/stylist/[identifier].tsx': `
        const response = await fetch(apiUrl, { method: 'GET' });
        jsonLdItems = buildStylistProfileJsonLdItems(response);
        export const Page = () => <JsonLdComposition data={jsonLdItems} />;
      `,
    });
    assert.deepEqual(messages(checkProfileSeo(good)), []);
  });

  void it('rejects a layout without the shell and a stray main id', () => {
    const files: Record<string, string> = {
      'main/src/UI/layouts/AppLayout.composition.tsx': LAYOUT(true, true),
      'main/src/UI/layouts/PublicLayout.composition.tsx': LAYOUT(true, false),
      'main/src/UI/layouts/AdminLayout.composition.tsx': LAYOUT(true, true),
      'main/src/UI/layouts/AccountWebLayout.composition.tsx': LAYOUT(
        true,
        true
      ),
      'main/src/UI/features/x/Other.tsx':
        "export const O = () => <main id='main-content' />;",
    };
    const found = messages(checkMainContent(tree(files)));
    assert.ok(
      found.some(message => message.includes('NavigationContentShell'))
    );
    assert.ok(found.some(message => message.includes('outside')));
  });

  void it('checks production landmarks without treating navigation test fixtures as layouts', () => {
    const root = tree({
      'main/src/UI/layouts/AppLayout.composition.tsx': LAYOUT(true, true),
      'main/src/UI/layouts/PublicLayout.composition.tsx': LAYOUT(true, true),
      'main/src/UI/layouts/AdminLayout.composition.tsx': LAYOUT(true, true),
      'main/src/UI/layouts/AccountWebLayout.composition.tsx': LAYOUT(
        true,
        true
      ),
      'main/src/UI/features/x/Other.tsx':
        "export const O = () => <main id='main-content' />;",
      'main/src/UI/features/x/Other.test.tsx':
        "render(<main id='main-content' />);",
      'main/src/UI/features/x/Other.spec.tsx':
        "render(<main id='main-content' />);",
    });
    const found = checkMainContent(root).findings;
    assert.equal(
      found.filter(hit => hit.file.endsWith('/Other.tsx')).length,
      1
    );
    assert.equal(
      found.filter(hit => /\.(test|spec)\.tsx$/.test(hit.file)).length,
      0
    );
  });

  void it('rejects an unknown test-user address and a one-file compose call', () => {
    const root = tree({
      '.shared-kernel/config/test-users.config.ts':
        "export const TEST_USERS_CONFIG = { email: 'known@example.com' };\n",
      'scripts/dev/preflight.sh': 'echo gone@example.com\n',
      'scripts/containers/_compose.sh':
        'dev_compose() { docker compose -f docker-compose.dev.yml -f docker-compose.dev-ssl.yml up; }\n',
      'scripts/bad.sh': 'docker compose -f docker-compose.dev.yml up\n',
      'package.json':
        '{ "scripts": { "up": "docker compose -f docker-compose.dev.yml -f docker-compose.dev-ssl.yml up" } }\n',
    });
    assert.ok(
      messages(checkTestUsers(root)).some(message =>
        message.includes('gone@example.com')
      )
    );
    assert.ok(
      messages(checkComposePairs(root)).some(message =>
        message.includes('_compose.sh')
      )
    );
  });

  void it('rejects a deploy script whose only gate is a comment', () => {
    const root = tree({
      'scripts/deploy/deploy-front':
        '# assert_artifact_served\n# git_parity_counts\necho ship\n',
      'scripts/deploy/deploy-back':
        'assert_artifact_served "$ID"\ngit_parity_counts\n',
    });
    assert.ok(
      messages(checkDeployArtifact(root)).some(message =>
        message.includes('BUILD_ID')
      )
    );
    assert.ok(
      messages(checkDeployOrigin(root)).some(message =>
        message.includes('git_parity_counts')
      )
    );
    assert.deepEqual(
      messages(
        checkDeployArtifact(
          tree({
            'scripts/deploy/deploy-front':
              '# artifact-identity-allow: orchestrator delegates the build id\n',
            'scripts/deploy/deploy-back': 'assert_artifact_served "$ID"\n',
          })
        )
      ),
      []
    );
  });

  void it('rejects a missing barrel and a missing llms-de literal', () => {
    const config = tree({
      'main/next.config.mjs':
        "export default { experimental: { optimizePackageImports: ['clsx'] } };\n",
    });
    assert.ok(
      messages(checkBundleImports(config)).some(message =>
        message.includes('@phosphor-icons/react')
      )
    );
    const llms = tree({
      'main/public/llms-de.txt': 'de\n',
      'main/public/robots.txt': 'Allow: /llms.txt\n',
      '.shared-kernel/domain/seo/ai-crawler-detection.ts':
        "const TRACKED_PATHS = ['/llms.txt'];\n",
      'scripts/copy-grep.mjs':
        "export const TEXT_SURFACES = ['main/public/llms.txt'];\n",
    });
    const found = messages(checkLlmsDe(llms));
    assert.ok(found.some(message => message.includes('robots')));
    assert.ok(found.some(message => message.includes('TRACKED_PATHS')));
  });

  void it('rejects a wizard that does not reset the app scroller', () => {
    const bad = tree({
      'main/src/UI/features/auth/Wizard.composition.tsx': `
        export const Wizard = () => <AppLayoutComposition />;
        const go = () => setStep(1);
      `,
    });
    assert.ok(messages(checkScrollReset(bad)).length > 0);
    const good = tree({
      'main/src/UI/features/auth/Wizard.composition.tsx': `
        export const Wizard = () => <AppLayoutComposition />;
        const go = () => setStep(1);
        const reset = () => document.getElementById('main-content').scrollTo({ top: 0 });
      `,
    });
    assert.deepEqual(messages(checkScrollReset(good)), []);
  });

  void it('rejects a component missing from the registry', () => {
    const root = tree({
      'main/src/UI/features/ui-library/uiLibrary.registry.ts':
        "export const rows = [{ importPath: 'src/UI/components/Button/Button.atom' }];\n",
      'main/src/UI/components/Button/Button.atom.tsx':
        'export const ButtonAtom = () => null;\n',
      'main/src/UI/components/Ghost/Ghost.atom.tsx':
        'export const GhostAtom = () => null;\n',
    });
    assert.ok(
      messages(checkUiLibrary(root)).some(message => message.includes('Ghost'))
    );
  });
});

void describe('deploy-artifact fixtures', () => {
  void it('excludes test modules while retaining deployment scripts and the presence floor', () => {
    const scripts = {
      'scripts/deploy/deploy-one':
        'git_parity_counts\nassert_artifact_served "$ID"\n',
      'scripts/deploy/deploy-two':
        'git_parity_counts\nassert_artifact_served "$ID"\n',
      'scripts/deploy/deploy-three':
        'git_parity_counts\nassert_artifact_served "$ID"\n',
      'scripts/deploy/deploy-one.test.mjs':
        'throw new Error("fixture only");\n',
    };
    const valid = tree(scripts);
    assert.deepEqual(messages(checkDeployArtifact(valid)), []);
    assert.deepEqual(messages(checkDeployOrigin(valid)), []);
    const invalid = tree({
      ...scripts,
      'scripts/deploy/deploy-one': 'echo deploy\n',
    });
    assert.ok(
      checkDeployArtifact(invalid).findings.some(hit =>
        hit.file.endsWith('deploy-one')
      )
    );
    assert.ok(
      checkDeployOrigin(invalid).findings.some(hit =>
        hit.file.endsWith('deploy-one')
      )
    );
    assert.ok(
      checkDeployArtifact(tree({ 'scripts/deploy/deploy-only.test.mjs': '' }))
        .errors.length > 0
    );
  });

  void it('matches the retired shell samples', () => {
    const dir = 'tests/audit/_fixtures/deploy-artifact-identity';
    const sample = (name: string): string =>
      tree({
        [`scripts/deploy/${name.slice(name.lastIndexOf('/') + 1)}`]:
          readFileSync(`${dir}/${name}`, 'utf8'),
        'scripts/deploy/deploy-anchor': 'assert_artifact_served "$ID"\n',
        'scripts/deploy/deploy-anchor-2':
          'git_parity_counts\nassert_artifact_served "$ID"\n',
      });
    assert.ok(
      messages(checkDeployArtifact(sample('must-fail/deploy-naked'))).length > 0
    );
    assert.ok(
      messages(checkDeployArtifact(sample('must-fail/deploy-comment-only')))
        .length > 0
    );
    assert.deepEqual(
      messages(checkDeployArtifact(sample('must-pass/deploy-with-gate'))),
      []
    );
    assert.deepEqual(
      messages(checkDeployArtifact(sample('must-pass/deploy-escaped'))),
      []
    );
  });
});

const anchors = {
  'main/src/UI/layouts/AppLayout.composition.tsx': LAYOUT(true, true),
  'main/src/UI/layouts/PublicLayout.composition.tsx': LAYOUT(true, true),
  'main/src/UI/layouts/AdminLayout.composition.tsx': LAYOUT(true, true),
  'main/src/UI/layouts/AccountWebLayout.composition.tsx': LAYOUT(true, true),
};

void describe('recognition counterexamples', () => {
  void it('does not treat a printed gate name as a deploy call', () => {
    const script =
      '#!/bin/bash\nprintf "%s\\n" "assert_artifact_served BUILD_ID build_id git_parity_counts"\n';
    const root = tree({
      'scripts/deploy/deploy-fake-1': script,
      'scripts/deploy/deploy-fake-2': script,
      'scripts/deploy/deploy-fake-3': script,
    });
    const artifact = checkDeployArtifact(root);
    const origin = checkDeployOrigin(root);
    assert.equal(artifact.errors.length, 0);
    assert.equal(origin.errors.length, 0);
    assert.equal(artifact.sites, 3);
    assert.equal(origin.sites, 3);
    assert.equal(artifact.findings.length, 3);
    assert.equal(origin.findings.length, 3);
  });

  void it('rejects a defined gate that is never invoked, a bare marker, and a quoted marker', () => {
    const defined = tree({
      'scripts/deploy/deploy-fn':
        '#!/bin/bash\nassert_artifact_served() { :; }\ngit_parity_counts() { :; }\n',
    });
    assert.ok(messages(checkDeployArtifact(defined)).length > 0);
    assert.ok(messages(checkDeployOrigin(defined)).length > 0);
    const wrapped = tree({
      'scripts/deploy/deploy-wrap':
        '#!/bin/bash\nwrap() { assert_artifact_served "$ID"; }\n',
    });
    assert.ok(messages(checkDeployArtifact(wrapped)).length > 0);
    const called = tree({
      'scripts/deploy/deploy-called':
        '#!/bin/bash\nwrap() { git_parity_counts "$D"; }\nwrap\n',
    });
    assert.deepEqual(messages(checkDeployOrigin(called)), []);
    const bare = tree({
      'scripts/deploy/deploy-bare':
        '#!/bin/bash\n# artifact-identity-allow:\necho ship\n',
    });
    assert.ok(
      messages(checkDeployArtifact(bare)).some(message =>
        message.includes('without a reason')
      )
    );
    const quoted = tree({
      'scripts/deploy/deploy-quoted':
        "#!/bin/bash\necho 'artifact-identity-allow: not a comment'\n",
    });
    assert.ok(
      messages(checkDeployArtifact(quoted)).some(message =>
        message.includes('BUILD_ID')
      )
    );
  });

  void it('keeps the frontend call, the command substitution, and the backend comparison', () => {
    const front = tree({
      'scripts/deploy/deploy-front':
        '#!/bin/bash\nif ! assert_artifact_served "$A" "$B"; then exit 1; fi\nread -r X Y <<< "$(git_parity_counts "$D")"\n',
    });
    assert.deepEqual(messages(checkDeployArtifact(front)), []);
    assert.deepEqual(messages(checkDeployOrigin(front)), []);
    const back = tree({
      'scripts/deploy/deploy-back':
        '#!/bin/bash\nif [ "$live_build_id" = "$BUILD_ID" ]; then echo ok; fi\n',
    });
    assert.deepEqual(messages(checkDeployArtifact(back)), []);
    assert.ok(messages(checkDeployOrigin(back)).length > 0);
  });

  void it('discovers a new root layout and ignores filler files and nested shells', () => {
    const base = checkMainContent(tree(anchors));
    const fillers: Record<string, string> = { ...anchors };
    for (let i = 0; i < 400; i += 1) {
      fillers[`main/src/UI/features/pad/Pad${i}.tsx`] =
        'export const P = () => <div>content</div>;';
    }
    const padded = checkMainContent(tree(fillers));
    assert.equal(padded.sites, base.sites);
    assert.deepEqual(messages(padded), []);
    const added: Record<string, string> = {
      ...anchors,
      'main/src/UI/layouts/NewLayout.composition.tsx':
        'export function NewLayoutComposition() { const note = "NavigationContentShellComposition id=\'main-content\'"; return <div>{note}</div>; }\n',
      'main/src/UI/layouts/AdminPageLayout.composition.tsx':
        'export function AdminPageLayoutComposition() { return <AdminLayoutComposition><div>content</div></AdminLayoutComposition>; }\n',
    };
    const found = checkMainContent(tree(added)).findings;
    assert.ok(found.some(hit => hit.file.includes('NewLayout.composition')));
    assert.equal(
      found.filter(hit => hit.file.includes('AdminPageLayout')).length,
      0
    );
    const aliased: Record<string, string> = {
      ...anchors,
      'main/src/UI/layouts/AliasLayout.composition.tsx': `
        import { NavigationContentShellComposition as Shell } from './NavigationContentShell.composition';
        export function AliasLayoutComposition() {
          return <main id="main-content"><Shell /></main>;
        }
      `,
    };
    assert.equal(
      checkMainContent(tree(aliased)).findings.filter(hit =>
        hit.file.includes('AliasLayout')
      ).length,
      0
    );
  });

  void it('does not let a quoted compose marker waive a real command', () => {
    const ssot = 'scripts/containers/_compose.sh';
    const bad =
      "echo 'compose-pair-allow: not a comment'\ndocker compose -f docker-compose.dev.yml up\n";
    const quoted = tree({
      [ssot]: 'dev_compose() { :; }\n',
      'scripts/bad.sh': bad,
      'package.json': '{ "scripts": {} }\n',
    });
    assert.ok(
      checkComposePairs(quoted).findings.some(
        hit => hit.file === 'scripts/bad.sh'
      )
    );
    const bare = tree({
      [ssot]: 'dev_compose() { :; }\n',
      'scripts/bad.sh':
        '# compose-pair-allow:\ndocker compose -f docker-compose.dev.yml up\n',
      'package.json': '{ "scripts": {} }\n',
    });
    assert.ok(
      checkComposePairs(bare).findings.some(hit =>
        hit.message.includes('without a reason')
      )
    );
    const allowed = tree({
      [ssot]: 'dev_compose() { :; }\n',
      'scripts/bad.sh':
        '# compose-pair-allow: one-off debug of a single file\ndocker compose -f docker-compose.dev.yml up\n',
      'package.json': '{ "scripts": {} }\n',
    });
    assert.deepEqual(messages(checkComposePairs(allowed)), []);
  });

  void it('requires a comment reason before a test-user escape', () => {
    const config =
      "export const TEST_USERS_CONFIG = { email: 'known@example.com' };\n";
    const root = tree({
      '.shared-kernel/config/test-users.config.ts': config,
      'scripts/bare.sh': 'echo gone@example.com # test-user-allow:\n',
      'scripts/quoted.sh':
        "echo gone@example.com; echo 'test-user-allow: not a comment'\n",
      'scripts/reason.sh':
        'echo gone@example.com # test-user-allow: fixture address, not a product login\n',
      'scripts/prose.cjs':
        "const note = 'the scanner must not treat gone@example.com as a login';\n",
      'scripts/account.cjs': "const email = 'other@example.com';\n",
    });
    const found = checkTestUsers(root).findings;
    assert.ok(
      found.some(
        hit =>
          hit.file === 'scripts/bare.sh' &&
          hit.message.includes('without a reason')
      )
    );
    assert.ok(
      found.some(
        hit =>
          hit.file === 'scripts/quoted.sh' &&
          hit.message.includes('gone@example.com')
      )
    );
    assert.ok(
      found.some(
        hit =>
          hit.file === 'scripts/account.cjs' &&
          hit.message.includes('other@example.com')
      )
    );
    assert.equal(
      found.filter(hit => hit.file === 'scripts/reason.sh').length,
      0
    );
    assert.equal(
      found.filter(hit => hit.file === 'scripts/prose.cjs').length,
      0
    );
  });
});

void describe('d5-surface live tree', () => {
  void it('passes every check on this checkout', () => {
    for (const check of run(projectRoot())) {
      assert.deepEqual(check.findings, [], check.name);
      assert.deepEqual(check.errors, [], check.name);
      assert.ok(
        check.sites >= check.minSites,
        `${check.name}: ${check.sites} < ${check.minSites}`
      );
    }
  });
});
