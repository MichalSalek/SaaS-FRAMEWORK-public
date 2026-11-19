import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRIAL_CONFIG } from '@kernel/domain/stripe/stripe.config';
import { TRIAL_DAYS_TOKEN } from '@kernel/domain/stripe/trial-policy-text';
import { getI18nMessages, getPublicPageMessages } from './i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from './page-messages.config';

// These are the authored trial-duration claims, including SEO and copy whose
// individual sentence does not contain the word "trial" (e.g. "After N days").
const trialPaths = [
  'pages.terms.sections.plansPayments.content',
  'seo.forStylists.jsonLd.feature10',
  'seo.pricing.jsonLd.feature10',
  'static.forStudios.pricingPreview.tierCtaLabel',
  'static.forStudios.pricingPreview.trialPriceAfter',
  'static.forStylists.faq.a04',
  'static.forStylists.pricing.trialPriceAfter',
  'static.helpCenter.faq.general.a2',
  'static.helpCenter.faq.stylists.a8',
  'static.helpCenter.faq.stylists.a11',
  'static.helpCenter.categories.items.subscription.description',
  'static.helpCenter.popularArticles.items.pricing.title',
  'static.pricing.trialEndowment.intro',
  'static.pricing.faq.a2',
  'static.pricing.faq.q2',
  'static.pricing.tierSection.trialPriceAfter',
  'static.pricing.tierSection.trialPriceAfterYearly',
  'static.pricing.trust.trialText',
  'static.pricing.trust.trialTitle',
  'components.trialOffer.eyebrowTrial',
  'components.trialOffer.trialSuffix',
];

function message(tree: unknown, path: string): string {
  const value = path.split('.').reduce<unknown>((node, key) => {
    if (typeof node !== 'object' || node === null) {
      return undefined;
    }
    return (node as Record<string, unknown>)[key];
  }, tree);
  expect(value, path).toBeTypeOf('string');
  return value as string;
}

function strings(tree: unknown, path = ''): Array<[string, string]> {
  if (typeof tree === 'string') {
    return [[path, tree]];
  }
  if (typeof tree !== 'object' || tree === null) {
    return [];
  }
  return Object.entries(tree).flatMap(([key, value]) =>
    strings(value, path ? `${path}.${key}` : key)
  );
}

describe('trial policy copy', () => {
  it('leaves no trial tokens in public Markdown or the full LLM mirror', () => {
    const publicDir = join(process.cwd(), 'public');
    const files = readdirSync(publicDir, {
      recursive: true,
      withFileTypes: true,
    });
    for (const file of files) {
      if (
        !file.isFile() ||
        (!file.name.endsWith('.md') && file.name !== 'llms-full.txt')
      ) {
        continue;
      }
      const filePath = join(file.parentPath, file.name);
      expect(readFileSync(filePath, 'utf8'), filePath).not.toContain(
        TRIAL_DAYS_TOKEN
      );
    }
  });

  it.each(['pl', 'en', 'de'])(
    'uses the configured duration in %s',
    async locale => {
      const raw = JSON.parse(
        readFileSync(
          join(process.cwd(), 'src/locales', locale, 'common.json'),
          'utf8'
        )
      ) as unknown;
      const loaded = await getI18nMessages(locale);
      for (const path of trialPaths) {
        const authored = message(raw, path);
        expect(authored, path).toContain(TRIAL_DAYS_TOKEN);
        // History and refund deadlines share these two paragraphs with trial copy.
        const trialOnly = authored
          .replace(/\b90 (?:dni|days|Tage)\b/g, '')
          .replace(/\b14 (?:dni|days|Tagen)\b/g, '');
        expect(trialOnly, path).not.toMatch(
          /\b\d+[- ](?:dni\w*|days?\b|Tage\w*|tägig\w*)/i
        );
        expect(message(loaded, path), path).toContain(
          String(TRIAL_CONFIG.DURATION_DAYS)
        );
      }
      expect(JSON.stringify(loaded)).not.toContain(TRIAL_DAYS_TOKEN);
      // Session frames must also be valid when Stripe resumes an older trial
      // with a different duration; the summary supplies its actual dates.
      for (const path of [
        'pages.onboarding.checkoutSubtitle',
        'account.pay.checkoutDialogTitleTrial',
        'account.checkout.trialTitle',
        'account.checkout.trialSub',
      ]) {
        expect(message(loaded, path), path).not.toMatch(/\d|\{days\}/);
      }
      expect(
        message(loaded, 'pages.terms.sections.withdrawalRight.content')
      ).toContain('14');
      expect(message(loaded, 'static.helpCenter.faq.general.a2')).toContain(
        '90'
      );

      // Catch new claims in other keys without banning unrelated retention
      // windows or the legally distinct withdrawal period.
      const trial = '(?:trial|próbn\\w*|Testphase|Testzeitraum|Pro-Test)';
      const duration = '\\b\\d+[- ](?:dni\\w*|days?\\b|Tage\\w*|tägig\\w*)';
      const numericTrial = new RegExp(
        `(?:${trial}[^.!?\\n]{0,60}${duration}|${duration}[^.!?\\n]{0,60}${trial})`,
        'i'
      );
      for (const [path, value] of strings(raw)) {
        if (path === 'pages.terms.sections.withdrawalRight.content') {
          continue;
        }
        expect(value, path).not.toMatch(numericTrial);
      }

      const pricing = await getPublicPageMessages(
        locale,
        PUBLIC_PAGE_MESSAGES['/pricing']
      );
      expect(
        message(pricing.buildMessages, 'seo.pricing.jsonLd.feature10')
      ).toContain(String(TRIAL_CONFIG.DURATION_DAYS));
      const prefix = locale === 'pl' ? '' : `${locale}/`;
      for (const page of ['pricing', 'for-stylists', 'help-center']) {
        const mirror = readFileSync(
          join(process.cwd(), 'public', prefix, `${page}.md`),
          'utf8'
        );
        expect(mirror, page).toContain(String(TRIAL_CONFIG.DURATION_DAYS));
        expect(mirror, page).not.toContain(TRIAL_DAYS_TOKEN);
      }
    }
  );
});
