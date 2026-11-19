import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { renderLegalText } from '../../components/Pii/PiiText.atom';
import {
  LegalDocLayoutComposition,
  LegalParagraphAtom,
  LegalSectionMolecule,
  type LegalDocTocItem,
} from './LegalDocLayout.composition';
import { LegalCalloutMolecule } from './LegalDocPrimitives.molecule';

/* ─── Sections that carry a leading callout highlight box ───
 * Klucze: pages.privacy.sections.<key>.callout (PL/EN/DE). */
const CALLOUT_SECTIONS = ['dataCollection', 'userRights'] as const;
type CalloutSection = (typeof CALLOUT_SECTIONS)[number];
// A type guard, not a Set<string>: the narrowed key lets the translation-key
// test (application/i18n/translation-keys.test.ts) check exactly these two.
const hasCallout = (key: string): key is CalloutSection =>
  (CALLOUT_SECTIONS as readonly string[]).includes(key);

/* ─── Section order — must match keys in locales/<lang>/common.json → pages.privacy.sections ─── */
const SECTION_KEYS = [
  'dataController',
  'dataCollection',
  'processingPurposes',
  'legalBasis',
  'photoRules',
  'qrPairing',
  'sessionShare',
  'dataSharing',
  'contactAccessLog',
  'dataRetention',
  'userRights',
  'automatedDecisions',
  'cookies',
  'dpoContact',
] as const;

/* ─── PrivacyPage ─── */
function PrivacyPageInner() {
  const t = useTranslations('pages.privacy');
  const tStatic = useTranslations('static.privacy');
  const tLegal = useTranslations('static.legal');

  // DECISION: locale section titles already carry the number ("1. Administrator danych"), so TOC
  // labels reuse them as-is; adding a number would print it twice.
  const toc: LegalDocTocItem[] = SECTION_KEYS.map(key => ({
    id: key,
    label: t(`sections.${key}.title`),
  }));

  return (
    <LegalDocLayoutComposition
      title={tLegal('title.privacy')}
      titleAccent={tLegal('titleAccent.privacy')}
      lede={tLegal('lede.privacy')}
      lastUpdatedLabel={t('lastUpdated')}
      bindingNote={t('bindingVersionNote')}
      tocHeading={tStatic('toc.heading')}
      tocAriaLabel={tStatic('toc.ariaLabel')}
      toc={toc}
      footerLastUpdatedLabel={tLegal('footer.lastUpdatedLabel')}
      footerLastUpdatedValue={t('lastUpdated')}
      printLabel={tLegal('footer.printLabel')}
      contactLabel={tLegal('footer.contactLabel')}
      backToTopLabel={tLegal('backToTop')}
      finalCta={{
        headlineLine1: tStatic('cta.heading'),
        body: tLegal('cta.bodyPrivacy'),
        primaryLabel: tStatic('cta.primaryBtn'),
        primaryHref: ROUTES_FRONT.FOR_STYLISTS,
        secondaryLabel: tStatic('cta.secondaryBtn'),
        secondaryHref: ROUTES_FRONT.PRICING,
      }}>
      {SECTION_KEYS.map(key => {
        const content = t(`sections.${key}.content`);
        const paragraphs = content.split('\n\n');
        const calloutText = hasCallout(key)
          ? t(`sections.${key}.callout`)
          : null;
        return (
          <LegalSectionMolecule
            key={key}
            id={key}
            title={t(`sections.${key}.title`)}>
            {calloutText ? (
              <LegalCalloutMolecule>{calloutText}</LegalCalloutMolecule>
            ) : null}
            {paragraphs.map((para, idx) => (
              <LegalParagraphAtom key={`${key}-p-${String(idx)}`}>
                {renderLegalText(para)}
              </LegalParagraphAtom>
            ))}
          </LegalSectionMolecule>
        );
      })}
    </LegalDocLayoutComposition>
  );
}

export function PrivacyPageComposition() {
  return (
    <PublicLayoutComposition>
      <PrivacyPageInner />
    </PublicLayoutComposition>
  );
}
