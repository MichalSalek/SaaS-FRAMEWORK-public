import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PricingPlanValue,
  getPlanDisplayName,
} from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import {
  planFeatureValue,
  resolvePlanFeatures,
} from '../../../application/pricing/plan-features.catalog';
import type { IntlMessages } from '../../../types/i18n';
import { formatPlanFeatureLines } from './planFeatures.jsonld';
import { renderLlmPricingSection } from './llmsPricingProjection';

const LOCALES = ['pl', 'en', 'de'] as const;
type Locale = (typeof LOCALES)[number];

function messagesFor(locale: Locale): IntlMessages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'src', 'locales', locale, 'common.json'),
      'utf8'
    )
  ) as IntlMessages;
}

describe('LLM pricing projection', () => {
  it.each(LOCALES)(
    '%s mirrors every plan feature through the UI catalog and locale formatter',
    locale => {
      const messages = messagesFor(locale);
      const localePath = locale === 'pl' ? '' : `/${locale}`;
      const pricingHref = `https://nailfolio.app${localePath}/pricing/`;
      const expected = PLAN_TIER_ORDER.flatMap(plan => [
        `### ${getPlanDisplayName(plan)}`,
        ...formatPlanFeatureLines(
          messages,
          locale,
          resolvePlanFeatures(plan)
        ).map(line => `- ${line}`),
      ]);
      expected.push(
        `[${messages.static.pricing.tiers.headline}](${pricingHref})`
      );

      expect(renderLlmPricingSection(messages, locale, pricingHref)).toEqual(
        expected
      );
    }
  );

  it('renders changed ICU copy with the current kernel limit', () => {
    const messages = structuredClone(messagesFor('en'));
    Object.assign(messages.account.plan.catalog.gallery, {
      limited: '{count, plural, one {catalog-one #} other {catalog-many #}}',
    });
    const gallery = planFeatureValue('gallery', PricingPlanValue.FREE);
    expect(gallery.kind).toBe('limited');
    if (gallery.kind !== 'limited') {
      throw new Error('Free gallery catalog value must have a current limit');
    }

    const rendered = renderLlmPricingSection(
      messages,
      'en',
      'https://nailfolio.app/en/pricing/'
    );

    expect(rendered).toContain(`- catalog-many ${gallery.count}`);
  });

  it('connects the generator to the projection without a duplicate price table', () => {
    const generator = readFileSync(
      resolve(process.cwd(), 'scripts', 'generate-llms-md.mjs'),
      'utf8'
    );

    expect(generator).toContain('renderLlmPricingSection');
    expect(generator).toContain("htmlUrl(locale, 'pricing')");
    expect(generator).toContain('deepClean(structuredClone(pricingMessages))');
    expect(generator).toContain(
      'buildPage(messages, page, locale, pricingMessages)'
    );
    expect(generator).not.toContain('const PRICE_TABLE');
  });
});
