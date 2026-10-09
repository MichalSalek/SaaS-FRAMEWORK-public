import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  ArrowRightIcon,
  CaretDownIcon,
  ClockIcon,
  EnvelopeIcon,
  ListBulletsIcon,
  PrinterIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { useScrollSpy } from '../../hooks/useScrollSpy';
import styles from './LegalDocLayout.module.css';

export interface LegalDocTocItem {
  id: string;
  label: string;
}

interface LegalDocFinalCta {
  eyebrow?: string;
  headlineLine1: string;
  headlineAccent?: string;
  body?: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export interface LegalDocLayoutProps {
  eyebrow: string;
  title: string;
  titleAccent?: string;
  lede?: string;
  lastUpdatedLabel: string;
  bindingNote?: string;
  tocHeading: string;
  tocAriaLabel: string;
  toc: readonly LegalDocTocItem[];
  /** Section bodies — rendered in body column. */
  children: ReactNode;
  /** Footer "last updated" repeat (small print). */
  footerLastUpdatedLabel: string;
  footerLastUpdatedValue: string;
  printLabel: string;
  contactLabel: string;
  backToTopLabel: string;
  finalCta?: LegalDocFinalCta;
}

/**
 * Shared shell for legal documents (Cookies / Terms / Privacy).
 *
 * Composition:
 *  1. Hero — eyebrow chip + serif-accent title + last-updated pill + binding note
 *  2. Reading section — sticky TOC (>= 1024px) / accordion (mobile) + body column
 *  3. Footer utility — print PDF + contact + last updated repeat
 *  4. Optional final CTA (solid brand color-block)
 *
 * Body content is composed by the caller via `children` so each doc can pick
 * its own section components (plain text, tables, callouts).
 */
export function LegalDocLayoutComposition({
  eyebrow,
  title,
  titleAccent,
  lede,
  lastUpdatedLabel,
  bindingNote,
  tocHeading,
  tocAriaLabel,
  toc,
  children,
  footerLastUpdatedLabel,
  footerLastUpdatedValue,
  printLabel,
  contactLabel,
  backToTopLabel,
  finalCta,
}: LegalDocLayoutProps) {
  const router = useRouter();
  const t = useTranslations('static.legal');
  const tocIds = useMemo(() => toc.map(item => item.id), [toc]);
  const activeId = useScrollSpy(tocIds);
  const [tocOpen, setTocOpen] = useState(false);

  // Close mobile TOC after clicking a link
  useEffect(() => {
    if (!tocOpen) {
      return;
    }
    const onResize = () => {
      if (window.innerWidth >= 1024) {
        setTocOpen(false);
      }
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [tocOpen]);

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <article className={styles.page}>
      {/* ─── 1. Hero ─── */}
      <section className={styles.hero} aria-labelledby='legal-hero-heading'>
        <div className={styles.heroInner}>
          <EyebrowAtom as='p' variant='plain' className={styles.eyebrow}>
            {eyebrow}
          </EyebrowAtom>
          <h1 id='legal-hero-heading' className={styles.heroHeadline}>
            {title}
            {titleAccent ? (
              <>
                {' '}
                <span className={styles.heroHeadlineAccent}>{titleAccent}</span>
              </>
            ) : null}
          </h1>
          {lede ? <p className={styles.heroLede}>{lede}</p> : null}
          <div className={styles.heroMeta}>
            <span className={styles.lastUpdatedPill}>
              <span className={styles.lastUpdatedIcon} aria-hidden='true'>
                <ClockIcon size={14} weight='fill' />
              </span>
              <span className={styles.lastUpdatedText}>{lastUpdatedLabel}</span>
            </span>
            {bindingNote ? (
              <p className={styles.bindingNote}>
                <span className={styles.bindingNoteIcon} aria-hidden='true'>
                  <ShieldCheckIcon size={14} weight='regular' />
                </span>
                <span>{bindingNote}</span>
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ─── Section marker ─── */}
      <div className={styles.sectionMarker} aria-hidden='true'>
        <span>{t('sectionMarker.content')}</span>
      </div>

      {/* ─── 2. Reading section: TOC + body ─── */}
      <SectionComposition
        className={styles.readingSection}
        innerClassName={styles.readingInner}>
        {/* ─── TOC ─── */}
        <div className={styles.tocWrap}>
          <button
            type='button'
            className={styles.tocToggle}
            aria-expanded={tocOpen}
            aria-controls='legal-toc'
            onClick={() => setTocOpen(open => !open)}>
            <span className={styles.tocToggleLabel}>
              <ListBulletsIcon size={18} weight='regular' aria-hidden='true' />
              {tocHeading}
            </span>
            <span className={styles.tocToggleIcon} aria-hidden='true'>
              <CaretDownIcon size={16} weight='bold' />
            </span>
          </button>
          <nav
            id='legal-toc'
            className={styles.toc}
            aria-label={tocAriaLabel}
            data-open={tocOpen ? 'true' : 'false'}>
            <p className={styles.tocHeading}>{tocHeading}</p>
            <ol className={styles.tocList}>
              {toc.map(item => {
                const isActive = item.id === activeId;
                return (
                  <li key={item.id} className={styles.tocItem}>
                    <a
                      href={`#${item.id}`}
                      className={styles.tocLink}
                      data-active={isActive ? 'true' : 'false'}
                      onClick={() => setTocOpen(false)}>
                      <span
                        className={styles.tocLinkIndicator}
                        aria-hidden='true'
                      />
                      <span className={styles.tocLinkText}>{item.label}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>

        {/* ─── Body ─── */}
        <div className={styles.body}>
          {children}
          <a href='#legal-hero-heading' className={styles.backToTop}>
            <ArrowRightIcon
              size={12}
              weight='bold'
              style={{ transform: 'rotate(-90deg)' }}
              aria-hidden='true'
            />
            {backToTopLabel}
          </a>
        </div>
      </SectionComposition>

      {/* ─── 3. Footer utilities ─── */}
      <SectionComposition
        as='div'
        className={styles.footerUtility}
        innerClassName={styles.footerInner}>
        <div className={styles.footerMeta}>
          <p className={styles.footerMetaLabel}>{footerLastUpdatedLabel}</p>
          <p className={styles.footerMetaValue}>{footerLastUpdatedValue}</p>
        </div>
        <div className={styles.footerActions}>
          <button
            type='button'
            className={styles.footerLink}
            onClick={handlePrint}>
            <span className={styles.footerLinkIcon} aria-hidden='true'>
              <PrinterIcon size={16} weight='regular' />
            </span>
            {printLabel}
          </button>
          <AppParagraphLinkAtom
            href={ROUTES_FRONT.CONTACT}
            className={styles.footerLink}>
            <span className={styles.footerLinkIcon} aria-hidden='true'>
              <EnvelopeIcon size={16} weight='regular' />
            </span>
            {contactLabel}
          </AppParagraphLinkAtom>
        </div>
      </SectionComposition>

      {/* ─── 4. Final CTA (optional) ─── */}
      {finalCta ? (
        <FinalCtaBandOrganism
          tone='ink'
          headlineLine1={finalCta.headlineLine1}
          headlineAccent={finalCta.headlineAccent}
          eyebrow={finalCta.eyebrow ?? t('sectionMarker.cta')}
          body={finalCta.body}
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={() => {
                void router.push(finalCta.primaryHref);
              }}>
              {finalCta.primaryLabel}
            </ButtonAtom>
          }
          secondary={
            finalCta.secondaryHref && finalCta.secondaryLabel ? (
              <AppParagraphLinkAtom href={finalCta.secondaryHref}>
                {finalCta.secondaryLabel}
              </AppParagraphLinkAtom>
            ) : undefined
          }
        />
      ) : null}
    </article>
  );
}

/* ─── Composition primitives re-exported from LegalDocPrimitives ─── */
export {
  LegalCalloutMolecule,
  LegalParagraphAtom,
  LegalSectionMolecule,
  legalDocStyles,
} from './LegalDocPrimitives.molecule';
