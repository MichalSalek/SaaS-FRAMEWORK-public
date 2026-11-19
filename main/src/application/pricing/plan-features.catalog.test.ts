import { describe, expect, it } from 'vitest';
import { createTranslator, type AbstractIntlMessages } from 'next-intl';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import {
  PRICING_POLICY,
  isUnlimitedLimit,
} from '@kernel/policies/pricing.policy';
import pl from '../../locales/pl/common.json';
import en from '../../locales/en/common.json';
import de from '../../locales/de/common.json';
import {
  PLAN_FEATURE_IDS,
  PLAN_FEATURE_NAMESPACE,
  PLAN_FEATURE_TABLE_ROWS,
  freePlanSummaryParams,
  planFeatureCell,
  planFeatureHighlights,
  planFeatureKeysInUse,
  planFeatureValue,
  pricingCardCopyParams,
  resolvePlanFeatures,
  type PlanFeatureId,
} from './plan-features.catalog';

const LOCALES = { pl, en, de } as const;
type LocaleName = keyof typeof LOCALES;
const LOCALE_NAMES = Object.keys(LOCALES) as LocaleName[];

type LooseTranslate = (
  key: string,
  values?: Readonly<Record<string, number>>
) => string;

const translator = (locale: LocaleName, namespace: string): LooseTranslate =>
  createTranslator({
    locale,
    messages: LOCALES[locale] as unknown as AbstractIntlMessages,
    namespace,
    onError: error => {
      throw error;
    },
  }) as unknown as LooseTranslate;

const lookup = (locale: LocaleName, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      LOCALES[locale]
    );

const leafPaths = (node: unknown, prefix: string): string[] =>
  node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        leafPaths(value, `${prefix}.${key}`)
      )
    : [prefix];

const ids = (plan: PricingPlan): PlanFeatureId[] =>
  resolvePlanFeatures(plan).map(line => line.id);

/** A sentinel no copy would contain: every digit in the output must come from it. */
// Below 1000: ICU formats numbers per locale, so 7777 would read "7,777" / "7.777".
const SENTINEL = 777;
const digitsOutsideSentinel = (text: string): string =>
  text.replaceAll(String(SENTINEL), '').replace(/[^0-9]/g, '');

describe('plan feature catalog: derived from the kernel', () => {
  it.each(PLAN_TIER_ORDER)(
    '%s: a capability flag is true exactly when its line shows',
    plan => {
      const limits = PRICING_POLICY.utils.getPlanConfig(plan);
      const shown = ids(plan);
      const pairs: readonly [boolean, PlanFeatureId][] = [
        [limits.can_brand_profile, 'brandColor'],
        [limits.can_have_salon_profile, 'salonProfile'],
        [limits.can_have_shared_salon_gallery, 'sharedSalonGallery'],
        [limits.can_use_staff_accounts, 'team'],
        [limits.can_use_staff_accounts, 'memberPlan'],
        [limits.can_use_session_share, 'qrSession'],
        [limits.can_view_history, 'history'],
        [limits.can_view_client_insights, 'clientInsights'],
        [plan !== PricingPlanValue.FREE, 'noWatermark'],
        [plan === PricingPlanValue.SCALE, 'customFeatures'],
        [plan === PricingPlanValue.SCALE, 'responseTime'],
        [plan === PricingPlanValue.SCALE, 'onboardingLead'],
      ];
      for (const [flag, id] of pairs) {
        expect({ id, shown: shown.includes(id) }).toEqual({ id, shown: flag });
      }
      expect(shown).toContain('publicProfile');
    }
  );

  it.each(PLAN_TIER_ORDER)('%s: every number is the kernel number', plan => {
    const limits = PRICING_POLICY.utils.getPlanConfig(plan);
    const expectLimit = (id: PlanFeatureId, kernel: number): void => {
      const value = planFeatureValue(id, plan);
      if (isUnlimitedLimit(kernel)) {
        expect(value).toEqual({ kind: 'unlimited' });
      } else if (kernel === 0) {
        expect(value).toEqual({ kind: 'absent' });
      } else {
        expect(value).toEqual({ kind: 'limited', count: kernel });
      }
    };
    expectLimit('gallery', limits.max_gallery_records);
    expectLimit('clients', limits.max_paired_clients);
    expectLimit('pinned', limits.max_pinned_records);
    expectLimit('history', limits.history_retention_days);
    const team = planFeatureValue('team', plan);
    if (!limits.can_use_staff_accounts) {
      expect(team.kind).toBe('absent');
    } else if (isUnlimitedLimit(limits.max_staff_members)) {
      expect(team.kind).toBe('unlimited');
    } else {
      // All accounts of the salon, the owner's included.
      expect(team).toEqual({
        kind: 'limited',
        count: limits.max_staff_members + 1,
      });
    }
  });

  it('closes the position-5 parity gaps by construction', () => {
    for (const plan of PLAN_TIER_ORDER) {
      expect(ids(plan)).toEqual(
        expect.arrayContaining(['qrSession', 'publicProfile'])
      );
    }
    expect(ids(PricingPlanValue.STUDIO)).toEqual(
      expect.arrayContaining([
        'brandColor',
        'salonProfile',
        'sharedSalonGallery',
        'memberPlan',
      ])
    );
  });

  it('drops owner-only lines for a plan inherited from a salon', () => {
    const member = resolvePlanFeatures(PricingPlanValue.STUDIO, {
      includeOwnerOnly: false,
    }).map(line => line.id);
    expect(member).not.toContain('team');
    expect(member).not.toContain('salonProfile');
    expect(member).toContain('sharedSalonGallery');
  });

  it('a highlight is a reordered cut of the full list, own lines first', () => {
    for (const plan of PLAN_TIER_ORDER) {
      const full = ids(plan);
      const top = planFeatureHighlights(plan, 4).map(line => line.id);
      expect(top).toHaveLength(Math.min(4, full.length));
      for (const id of top) {
        expect(full).toContain(id);
      }
    }
    expect(
      planFeatureHighlights(PricingPlanValue.PRO_PLUS, 2).map(line => line.id)
    ).toEqual(['history', 'brandColor']);
    expect(
      planFeatureHighlights(PricingPlanValue.STUDIO, 1).map(line => line.id)
    ).toEqual(['team']);
  });

  it('the comparison table has one cell per row and plan', () => {
    expect(PLAN_FEATURE_TABLE_ROWS.length).toBeGreaterThan(0);
    for (const row of PLAN_FEATURE_TABLE_ROWS) {
      for (const plan of PLAN_TIER_ORDER) {
        expect(planFeatureCell(row.id, plan).kind).toMatch(/^(flag|text|key)$/);
      }
    }
  });
});

describe('plan feature catalog: copy', () => {
  const catalogKeys = (locale: LocaleName): string[] =>
    leafPaths(
      lookup(locale, `${PLAN_FEATURE_NAMESPACE}.catalog`),
      'catalog'
    ).sort();

  it('every key the catalog asks for exists in pl, en and de, and no key is dead', () => {
    const inUse = planFeatureKeysInUse();
    for (const locale of LOCALE_NAMES) {
      expect(catalogKeys(locale)).toEqual(inUse);
    }
  });

  it('every id has at least one line or row', () => {
    const inUse = planFeatureKeysInUse().join(' ');
    for (const id of PLAN_FEATURE_IDS) {
      expect(inUse).toContain(`catalog.${id}.`);
    }
  });

  it.each(LOCALE_NAMES)(
    '%s: no catalog string carries a number of its own',
    locale => {
      const t = translator(locale, PLAN_FEATURE_NAMESPACE);
      for (const key of planFeatureKeysInUse()) {
        const text = t(key, { count: SENTINEL });
        expect({ key, digits: digitsOutsideSentinel(text) }).toEqual({
          key,
          digits: '',
        });
        if (/\.(limited|cellLimited)$/.test(key)) {
          // A limited line must SHOW the kernel number, not just accept it.
          expect({ key, text }).toEqual({
            key,
            text: expect.stringContaining(String(SENTINEL)),
          });
        }
      }
    }
  );

  it.each(LOCALE_NAMES)(
    '%s: plan sentences outside the lists take their numbers from the kernel',
    locale => {
      const sentinelOf = <T extends Record<string, number>>(
        params: T
      ): Record<keyof T, number> =>
        Object.fromEntries(
          Object.keys(params).map(key => [key, SENTINEL])
        ) as Record<keyof T, number>;
      const pay = translator(locale, 'account.pay');
      const card = translator(locale, 'static.pricing');
      const cardParams = sentinelOf(pricingCardCopyParams());
      const cases: readonly [string, string][] = [
        [
          'account.pay.heroMetaFree',
          pay('heroMetaFree', sentinelOf(freePlanSummaryParams())),
        ],
        [
          'account.pay.taglineFree',
          pay('taglineFree', sentinelOf(freePlanSummaryParams())),
        ],
        [
          'static.pricing.tiers.proTagline',
          card('tiers.proTagline', cardParams),
        ],
        [
          'static.pricing.tiers.studioTagline',
          card('tiers.studioTagline', cardParams),
        ],
      ];
      for (const [key, text] of cases) {
        expect({ key, digits: digitsOutsideSentinel(text) }).toEqual({
          key,
          digits: '',
        });
        expect(text).toContain(String(SENTINEL));
      }
      expect(pay('heroMetaFree', freePlanSummaryParams())).toContain(
        String(PRICING_POLICY.LIMITS.FREE.max_gallery_records)
      );
      // The meta description is read raw by the llms mirror generator, which
      // cannot interpolate: it names plans without any number.
      expect(
        digitsOutsideSentinel(String(lookup(locale, 'seo.pricing.description')))
      ).toBe('');
    }
  );
});
