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

/* ─── Section order — must match keys in locales/<lang>/common.json → pages.terms.sections ─── */
const SECTION_KEYS = [
  'definitions',
  'registration',
  'galleryRules',
  'qrPairing',
  'sessionShare',
  'plansPayments',
  'staffAccounts',
  'intellectualProperty',
  'liability',
  'termination',
  'withdrawalRight',
  'complaints',
  'finalProvisions',
] as const;

/* ─── TermsPage ─── */
function TermsPageInner() {
  const t = useTranslations('pages.terms');
  const tStatic = useTranslations('static.terms');
  const tLegal = useTranslations('static.legal');

  // DECISION (nie usuwaj tego komentarza):
  // Section titles in PL/EN/DE locales already include the number prefix
  // (e.g. "1. Definicje") — TOC labels reuse them as-is to avoid double
  // numbering ("1. 1. Definicje").
  const toc: LegalDocTocItem[] = SECTION_KEYS.map(key => ({
    id: key,
    label: t(`sections.${key}.title`),
  }));

  return (
    <LegalDocLayoutComposition
      eyebrow={tLegal('eyebrow.terms')}
      title={tLegal('title.terms')}
      titleAccent={tLegal('titleAccent.terms')}
      lede={tLegal('lede.terms')}
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
        body: tLegal('cta.bodyTerms'),
        primaryLabel: tStatic('cta.primaryBtn'),
        primaryHref: ROUTES_FRONT.FOR_STYLISTS,
        secondaryLabel: tStatic('cta.secondaryBtn'),
        secondaryHref: ROUTES_FRONT.PRICING,
      }}>
      {SECTION_KEYS.map(key => {
        const content = t(`sections.${key}.content`);
        const paragraphs = content.split('\n\n');
        return (
          <LegalSectionMolecule
            key={key}
            id={key}
            title={t(`sections.${key}.title`)}>
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

export function TermsPageComposition() {
  return (
    <PublicLayoutComposition>
      <TermsPageInner />
    </PublicLayoutComposition>
  );
}
