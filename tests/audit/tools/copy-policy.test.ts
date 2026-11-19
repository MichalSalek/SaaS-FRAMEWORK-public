// Mutation proofs and compatibility samples for copy-policy.
import assert from 'node:assert/strict';
import {
  cpSync,
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
import { fileURLToPath } from 'node:url';
import {
  checkBillingEmailCta,
  checkBillingPlanId,
  checkBillingPrices,
  checkBlogCopy,
  checkCopyDashes,
  checkCopyDeSie,
  checkCopyPhrases,
  run,
} from './copy-policy';
import type { CheckResult } from './_lib';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const MUTATIONS = path.join(
  REPO,
  'tests/audit/_fixtures/copy-policy-mutations'
);

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-copy-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

const sentence = (text: string): string => `${JSON.stringify({ ok: text })}\n`;

const BASE: Record<string, string> = {
  'main/src/locales/pl/common.json': sentence('Zwykłe zdanie.'),
  'main/src/locales/en/common.json': sentence('A plain sentence.'),
  'main/src/locales/de/common.json': sentence('Ein ganzer Satz.'),
  'main/src/locales/pl/events.json': sentence('Zwykłe zdanie.'),
  'main/src/locales/en/events.json': sentence('A plain sentence.'),
  'main/src/locales/de/events.json': sentence('Ein ganzer Satz.'),
  '.shared-kernel/domain/email/locales/email-i18n.pl.json':
    sentence('Zwykłe zdanie.'),
  '.shared-kernel/domain/email/locales/email-i18n.en.json':
    sentence('A plain sentence.'),
  '.shared-kernel/domain/email/locales/email-i18n.de.json':
    sentence('Ein ganzer Satz.'),
  'main/public/llms.txt': 'Nailfolio\n',
  'main/public/llms-pl.txt': 'Nailfolio\n',
  'main/public/llms-de.txt': 'Nailfolio\n',
  'main/src/fixture/stub.atom.tsx':
    'export function Stub() { return <p>Zwykły tekst</p>; }\n',
  'main/src/fixture/stub.module.css': '.stub { color: inherit; }\n',
  'main/src/fixture/plan.ts':
    'export const row = { planId: readPlan() };\ndeclare function readPlan(): string;\n',
  'web-1/src/keep.ts': "export const keep = 'routed';\n",
  '.shared-kernel/keep.ts': "export const keep = 'routed';\n",
  'web-1/src/application/email-handler/keep.ts':
    "export const href = 'routes';\n",
  'main/src/content/blog/ok.mdx': [
    '---',
    "title: 'T'",
    "description: 'D'",
    "date: '2026-01-01'",
    "category: 'tips-for-stylists'",
    "locale: 'pl'",
    "author: 'Nailfolio'",
    "coverImage: '/x.webp'",
    '---',
    '',
    'Zdanie.',
    '',
  ].join('\n'),
};

function withBase(files: Record<string, string> = {}): string {
  return tree({ ...BASE, ...files });
}

function fixture(name: string): string {
  return readFileSync(path.join(MUTATIONS, name), 'utf8');
}

const messages = (check: CheckResult): string[] =>
  check.findings.map(
    finding => `${finding.file}:${finding.line} ${finding.message}`
  );

function quiet(check: CheckResult): void {
  assert.deepEqual(check.errors, [], messages(check).join('\n'));
  assert.deepEqual(check.findings, [], messages(check).join('\n'));
  assert.ok(
    check.sites >= check.minSites,
    `${check.name} ${check.sites} < ${check.minSites}`
  );
}

function materialize(sample: string, targetDir: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-copy-fx-'));
  tmpRoots.push(root);
  const place = (src: string, base: string): void => {
    const rel = base.includes('%')
      ? base.split('%').join('/')
      : `${targetDir}/${base}`;
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest);
  };
  if (statSync(sample).isDirectory()) {
    for (const name of readdirSync(sample)) {
      const src = path.join(sample, name);
      if (statSync(src).isFile()) {
        place(src, name);
      }
    }
  } else {
    place(sample, path.basename(sample));
  }
  return root;
}

function targetOf(audit: string): string {
  return (
    readFileSync(
      path.join(REPO, 'tests/audit/_fixtures', audit, '_target.txt'),
      'utf8'
    )
      .split('\n')[0]
      ?.trim() ?? ''
  );
}

function samples(audit: string, kind: 'must-fail' | 'must-pass'): string[] {
  const dir = path.join(REPO, 'tests/audit/_fixtures', audit, kind);
  return readdirSync(dir)
    .filter(name => !name.endsWith('.expect') && !name.endsWith('.expect-not'))
    .sort()
    .map(name => path.join(dir, name));
}

void describe('copy-policy mutations', () => {
  void it('accepts a quiet mini tree on every check', () => {
    const root = withBase();
    for (const check of run(root)) {
      quiet(check);
    }
  });

  void it('errors when a scan root is missing', () => {
    const root = tree({});
    assert.ok(checkCopyDashes(root).errors.length > 0);
    assert.ok(checkCopyPhrases(root).errors.length > 0);
    assert.ok(checkCopyDeSie(root).errors.length > 0);
    assert.ok(checkBlogCopy(root).errors.length > 0);
    assert.ok(checkBillingPlanId(root).errors.length > 0);
    assert.ok(checkBillingEmailCta(root).errors.length > 0);
    assert.ok(checkBillingPrices(root).errors.length > 0);
  });

  void it('flags a dash in a value and ignores the same character in a key', () => {
    const hit = checkCopyDashes(
      withBase({
        'main/src/locales/pl/common.json': fixture('dash-entity.json'),
      })
    );
    assert.ok(messages(hit).some(message => message.includes('em/en dash')));
    quiet(
      checkCopyDashes(
        withBase({
          'main/src/locales/pl/common.json': fixture('dash-in-key.json'),
        })
      )
    );
  });

  void it('flags a rendered middle dot and stays quiet for a comment or a non-content property', () => {
    const value = checkCopyDashes(
      withBase({ 'main/src/fixture/meta.tsx': fixture('middle-dot-value.tsx') })
    );
    assert.ok(messages(value).some(message => message.includes('middle dot')));
    quiet(
      checkCopyDashes(
        withBase({
          'main/src/fixture/meta.tsx': fixture('middle-dot-comment.tsx'),
        })
      )
    );
    const content = checkCopyDashes(
      withBase({
        'main/src/fixture/list.module.css': fixture('middle-dot-content.css'),
      })
    );
    assert.ok(
      messages(content).some(message => message.includes('CSS content'))
    );
    quiet(
      checkCopyDashes(
        withBase({
          'main/src/fixture/list.module.css': fixture(
            'middle-dot-css-comment.css'
          ),
        })
      )
    );
    quiet(
      checkCopyDashes(
        withBase({
          'main/src/fixture/list.module.css': fixture(
            'middle-dot-css-other.css'
          ),
        })
      )
    );
    quiet(
      checkCopyDashes(
        withBase({
          'main/src/fixture/list.module.css': fixture(
            'middle-dot-css-reason.css'
          ),
        })
      )
    );
  });

  void it('rejects a bare middle-dot marker and a quoted marker that does not waive', () => {
    const bare = checkCopyDashes(
      withBase({ 'main/src/fixture/title.tsx': fixture('middle-dot-bare.tsx') })
    );
    assert.ok(
      messages(bare).some(message => message.includes('bare middle-dot-allow'))
    );
    const quoted = checkCopyDashes(
      withBase({
        'main/src/fixture/title.tsx': fixture('middle-dot-quoted.tsx'),
      })
    );
    assert.ok(messages(quoted).some(message => message.includes('middle dot')));
    assert.ok(
      !messages(quoted).some(message =>
        message.includes('bare middle-dot-allow')
      )
    );
  });

  void it('flags a planId string literal and ignores a comment, a type, and a mentioning string', () => {
    const hit = checkBillingPlanId(
      withBase({ 'main/src/fixture/bad-plan.ts': fixture('planid-value.ts') })
    );
    assert.ok(
      messages(hit).some(message => message.includes('planId string literal'))
    );
    quiet(
      checkBillingPlanId(
        withBase({ 'main/src/fixture/plan.ts': fixture('planid-comment.ts') })
      )
    );
    quiet(
      checkBillingPlanId(
        withBase({ 'main/src/fixture/plan.ts': fixture('planid-mentioned.ts') })
      )
    );
    quiet(
      checkBillingPlanId(
        withBase({ 'main/src/fixture/plan.ts': fixture('planid-type.ts') })
      )
    );
  });

  void it('rejects a bare planId marker and a quoted marker that does not waive', () => {
    const bare = checkBillingPlanId(
      withBase({ 'main/src/fixture/bad-plan.ts': fixture('planid-bare.ts') })
    );
    assert.ok(
      messages(bare).some(message =>
        message.includes('bare planid-literal-allow')
      )
    );
    const quoted = checkBillingPlanId(
      withBase({ 'main/src/fixture/bad-plan.ts': fixture('planid-quoted.ts') })
    );
    assert.ok(
      messages(quoted).some(message =>
        message.includes('planId string literal')
      )
    );
    assert.ok(
      !messages(quoted).some(message =>
        message.includes('bare planid-literal-allow')
      )
    );
  });

  void it('flags a banned phrase in a value and ignores the same words in a comment', () => {
    const hit = checkCopyPhrases(
      withBase({
        'main/src/locales/pl/common.json': fixture('phrase-value.json'),
      })
    );
    assert.ok(
      messages(hit).some(message => message.includes('polish-as-quality'))
    );
    quiet(
      checkCopyPhrases(
        withBase({ 'main/src/fixture/note.ts': fixture('phrase-comment.ts') })
      )
    );
    quiet(
      checkCopyPhrases(
        withBase({
          'main/src/locales/pl/common.json': fixture(
            'phrase-review-allow.json'
          ),
        })
      )
    );
    const founder = checkCopyPhrases(
      withBase({
        'main/src/locales/pl/common.json': fixture(
          'phrase-founder-in-review.json'
        ),
      })
    );
    assert.ok(
      messages(founder).some(message => message.includes('founder-given-name'))
    );
  });

  void it('flags German du-form, including a sentence that only mentions the rule', () => {
    const hit = checkCopyDeSie(
      withBase({
        'main/src/locales/de/common.json': fixture('de-pronoun.json'),
      })
    );
    assert.ok(messages(hit).some(message => message.includes('du-form')));
    const mentions = checkCopyDeSie(
      withBase({
        'main/src/locales/de/common.json': fixture('de-mentions-rule.json'),
      })
    );
    assert.ok(messages(mentions).some(message => message.includes('du-form')));
    quiet(
      checkCopyDeSie(
        withBase({
          'main/src/locales/de/common.json': fixture('de-review.json'),
        })
      )
    );
  });

  void it('reads blog front matter and ignores the same words in the body', () => {
    const missing = checkBlogCopy(
      withBase({
        'main/src/content/blog/ok.mdx': fixture('blog-description-in-body.mdx'),
      })
    );
    assert.ok(
      messages(missing).some(message =>
        message.includes("missing 'description'")
      )
    );
    quiet(
      checkBlogCopy(
        withBase({
          'main/src/content/blog/ok.mdx': fixture('blog-author-in-body.mdx'),
        })
      )
    );
    quiet(
      checkBlogCopy(
        withBase({
          'main/src/application/blog/blog.utils.ts': fixture(
            'blog-utils-comment.ts'
          ),
        })
      )
    );
    const banned = checkBlogCopy(
      withBase({
        'main/src/application/blog/blog.utils.ts': fixture(
          'blog-utils-string.ts'
        ),
      })
    );
    assert.ok(
      messages(banned).some(message => message.includes('banned author'))
    );
  });

  void it('keeps the price allowlist and the currency-aware free-price placeholder', () => {
    const prices = checkBillingPrices(
      withBase({
        'main/src/locales/pl/common.json': fixture('price-allowlist.json'),
      })
    );
    const found = messages(prices);
    assert.ok(found.some(message => message.includes('static.pricing.hero')));
    assert.ok(
      found.some(message => message.includes('anchorBanner.textExtra'))
    );
    assert.ok(!found.some(message => message.includes('reviews')));
    assert.ok(!found.some(message => message.includes('anchorBanner.text)')));
    assert.ok(!found.some(message => message.includes('compare.faq.a4')));
    const lede = checkBillingPrices(
      withBase({
        'main/src/locales/pl/common.json': fixture('lede-missing.json'),
        'main/src/locales/en/common.json': fixture('lede-missing.json'),
        'main/src/locales/de/common.json': fixture('lede-missing.json'),
      })
    );
    assert.ok(messages(lede).some(message => message.includes('{price}')));
    const hardcoded = checkBillingPrices(
      withBase({
        'main/src/locales/en/common.json': '{"freeLede":"Free Demo 0 PLN"}',
      })
    );
    assert.ok(messages(hardcoded).some(message => message.includes('{price}')));
    quiet(
      checkBillingPrices(
        withBase({
          'main/src/locales/pl/common.json': fixture('lede-ok.json'),
          'main/src/locales/en/common.json': fixture('lede-ok.json'),
          'main/src/locales/de/common.json': fixture('lede-ok.json'),
        })
      )
    );
  });

  void it('flags {{appUrl}}/ in a template chunk and ignores it in a comment', () => {
    const hit = checkBillingEmailCta(
      withBase({
        'web-1/src/application/email-handler/keep.ts': fixture('email-cta.ts'),
      })
    );
    assert.ok(messages(hit).some(message => message.includes('{{appUrl}}/')));
    quiet(
      checkBillingEmailCta(
        withBase({
          'web-1/src/application/email-handler/keep.ts': fixture(
            'email-cta-comment.ts'
          ),
        })
      )
    );
  });
});

void describe('copy-policy compatibility samples', () => {
  void it('matches copy-dashes must-fail and must-pass fixtures', () => {
    const target = targetOf('copy-dashes');
    for (const sample of samples('copy-dashes', 'must-fail')) {
      const result = checkCopyDashes(materialize(sample, target));
      assert.equal(
        result.errors.length,
        0,
        `${sample}\n${result.errors.join('\n')}`
      );
      assert.ok(result.findings.length > 0, sample);
    }
    for (const sample of samples('copy-dashes', 'must-pass')) {
      quiet(checkCopyDashes(materialize(sample, target)));
    }
  });

  void it('matches copy-phrase-blacklist must-fail and must-pass fixtures', () => {
    const target = targetOf('copy-phrase-blacklist');
    for (const sample of samples('copy-phrase-blacklist', 'must-fail')) {
      const result = checkCopyPhrases(materialize(sample, target));
      assert.equal(
        result.errors.length,
        0,
        `${sample}\n${result.errors.join('\n')}`
      );
      assert.ok(
        result.findings.some(finding =>
          finding.message.includes('founder-given-name')
        ),
        `${sample}\n${messages(result).join('\n')}`
      );
    }
    for (const sample of samples('copy-phrase-blacklist', 'must-pass')) {
      quiet(checkCopyPhrases(materialize(sample, target)));
    }
  });

  void it('matches blog-copy-rules must-fail and must-pass fixtures', () => {
    const target = targetOf('blog-copy-rules');
    for (const sample of samples('blog-copy-rules', 'must-fail')) {
      const result = checkBlogCopy(materialize(sample, target));
      assert.equal(
        result.errors.length,
        0,
        `${sample}\n${result.errors.join('\n')}`
      );
      assert.ok(
        result.findings.length > 0,
        `${sample}\n${messages(result).join('\n')}`
      );
    }
    for (const sample of samples('blog-copy-rules', 'must-pass')) {
      quiet(checkBlogCopy(materialize(sample, target)));
    }
  });
});
