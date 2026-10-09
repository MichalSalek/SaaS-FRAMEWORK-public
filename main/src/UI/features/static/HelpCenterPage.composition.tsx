import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  CalendarBlankIcon,
  ImagesIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  QrCodeIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { LP_ASSETS } from '../../assets/lpAssets';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import {
  TABS,
  HelpCenterAccordionMolecule,
} from './HelpCenterAccordion.molecule';
import type { TabKey } from './HelpCenterAccordion.molecule';
import {
  CategoriesGridOrganism,
  PopularArticlesOrganism,
} from './HelpCenterPage.blocks.organism';
import {
  BottomCtaOrganism,
  ContactFooterOrganism,
  PopularTagsOrganism,
} from './HelpCenterPage.cta.organism';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import styles from './HelpCenterPage.module.css';
import {
  trackCtaClick,
  withCtaTracking,
} from '../../../application/analytics/cta-events';

/* ─── How It Works icon map (kept inline — only 4 entries, no need to split) ─── */

const HOW_IT_WORKS_ICONS = [
  QrCodeIcon,
  ImagesIcon,
  PaperPlaneTiltIcon,
  CalendarBlankIcon,
] as const;

const HOW_IT_WORKS_KEYS = [
  { titleKey: 'wizard.step1Title', bodyKey: 'wizard.step1Body' },
  { titleKey: 'wizard.step2Title', bodyKey: 'wizard.step2Body' },
  { titleKey: 'wizard.step3Title', bodyKey: 'wizard.step3Body' },
  { titleKey: 'wizard.step4Title', bodyKey: 'wizard.step4Body' },
] as const;

/* ─── HelpCenterPage ─── */

/**
 * Help Center / Knowledge Base landing.
 *
 * Editorial knowledge-base composition (W6 patterns):
 * 1. Hero — eyebrow chip + large search hero + popular tag chips (Notion docs)
 * 2. Categories grid — 6 cards icon + title + description + article count (Stripe Docs)
 * 3. Popular articles — top 5 numbered with read time (Linear docs)
 * 4. How It Works wizard — 4-step (Notion onboarding)
 * 5. FAQ tabs + accordion — full knowledge base
 * 6. Contact CTA footer — "Still need help?" (Vercel help footer)
 * 7. Bottom CTA — secondary path to product
 *
 * DECISION (nie usuwaj tego komentarza):
 * Search is the primary interaction — when user clicks a popular tag or
 * a category card, the FAQ tab is updated AND we scroll smoothly to #faq
 * so the answer appears in context, not buried under hero. This keeps a
 * single FAQ engine instead of duplicating articles per category page.
 */
export function HelpCenterPageComposition() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.helpCenter');

  function handleTagClick(query: string) {
    setSearchQuery(query);
    searchInputRef.current?.focus();
    const faqEl = document.getElementById('faq');
    if (faqEl) {
      faqEl.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function handleCategoryClick(tab: TabKey) {
    setActiveTab(tab);
    setSearchQuery('');
  }

  // Deep-link support: the support-page FAQ shortcut cards (and any marketing
  // link) navigate here with `?tab=<TabKey>`. Without reading it, the cards
  // landed on Help Center but the tab stayed 'general' and the page never moved
  // to the FAQ — owner: "nie zmieniają taba, strona się nie scrolluje, myślałem
  // że to bug z przyciskami". Read + validate the param, preselect the category
  // and scroll to #faq. Runs on router.query.tab changes (deep-link only —
  // in-page tab clicks mutate state, not the URL, so this never fights them).
  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const raw = router.query.tab;
    const tab = Array.isArray(raw) ? raw[0] : raw;
    if (tab == null || !TABS.some(candidate => candidate.key === tab)) {
      return;
    }
    setActiveTab(tab as TabKey);
    // Defer the scroll one frame: on a fresh deep-link mount the FAQ section
    // sits below the hero/search/category blocks (with staggerIn), so an
    // immediate scrollIntoView can measure a stale position and land short.
    const id = window.setTimeout(() => {
      document
        .getElementById('faq')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(id);
  }, [router.isReady, router.query.tab]);

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. Hero — search-first knowledge base ─── */}
        <section
          className={styles.hero}
          style={{ '--stagger-index': 0 } as React.CSSProperties}>
          <div className={styles.heroInner}>
            {/* Dekoracyjna nitka wątku pomocy — asymetryczny akcent po prawej,
              aria-hidden, nie nachodzi na search. Ukrywa się na mobile. */}
            <Image
              src={LP_ASSETS.decor.staticHelpThread}
              alt=''
              aria-hidden='true'
              width={160}
              height={200}
              className={styles.heroDecor}
              unoptimized
            />
            <h1 className={styles.heroHeadline}>{t('hero.title')}</h1>
            <p className={styles.heroSubtext}>{t('hero.subtitle')}</p>

            <form
              className={styles.heroSearch}
              role='search'
              onSubmit={e => {
                e.preventDefault();
                const faqEl = document.getElementById('faq');
                if (faqEl) {
                  faqEl.scrollIntoView({ behavior: 'smooth' });
                }
              }}>
              <label htmlFor='help-search-input' className={styles.srOnly}>
                {t('search.ariaLabel')}
              </label>
              <span className={styles.heroSearchIcon} aria-hidden='true'>
                <MagnifyingGlassIcon size={22} weight='bold' />
              </span>
              <input
                ref={searchInputRef}
                id='help-search-input'
                type='search'
                className={styles.heroSearchInput}
                placeholder={t('search.placeholder')}
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                }}
                aria-label={t('search.ariaLabel')}
              />
              <button
                type='submit'
                className={styles.heroSearchSubmit}
                aria-label={t('search.submit')}>
                {t('search.submit')}
              </button>
            </form>

            <PopularTagsOrganism onTagClick={handleTagClick} />
          </div>
        </section>

        {/* ─── 2. Categories grid (Stripe Docs landing) ─── */}
        <CategoriesGridOrganism onCategoryClick={handleCategoryClick} />

        {/* ─── 3. Popular articles (Linear docs) ─── */}
        <PopularArticlesOrganism onArticleClick={handleCategoryClick} />

        {/* ─── 4. How It Works — 4-step wizard ─── */}
        <section
          className={styles.wizardSection}
          aria-label={t('wizard.ariaLabel')}
          style={{ '--stagger-index': 1 } as React.CSSProperties}>
          <SectionHeaderMolecule
            align='center'
            className={styles.helpHeader}
            title={t('wizard.heading')}
          />
          <div className={styles.wizardSteps}>
            {HOW_IT_WORKS_KEYS.map((step, i) => {
              const Icon = HOW_IT_WORKS_ICONS[i];
              return (
                <div key={step.titleKey} className={styles.wizardStepWrap}>
                  <div
                    className={styles.wizardStep}
                    style={{ '--stagger-index': i + 2 } as React.CSSProperties}>
                    <div className={styles.wizardStepIcon} aria-hidden='true'>
                      <Icon size={24} weight='regular' />
                    </div>
                    <span
                      className={styles.wizardStepNumeral}
                      aria-hidden='true'>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p className={styles.wizardStepTitle}>{t(step.titleKey)}</p>
                    <p className={styles.wizardStepBody}>{t(step.bodyKey)}</p>
                  </div>
                  {i < HOW_IT_WORKS_KEYS.length - 1 && (
                    <div
                      className={styles.wizardConnector}
                      aria-hidden='true'
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className={styles.wizardCta}>
            {t('wizard.ctaText')}{' '}
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.CONTACT}
              className={styles.wizardCtaLink}
              onClick={() => trackCtaClick('help-center-contact')}>
              {t('wizard.ctaLink')}
            </AppParagraphLinkAtom>
          </p>
        </section>

        {/* ─── 5. FAQ — tabs + accordion ─── */}
        <section
          id='faq'
          className={styles.faqWrapper}
          aria-label={t('tabs.sectionHeadline')}>
          <SectionHeaderMolecule
            align='center'
            className={styles.helpHeader}
            eyebrow={t('tabs.sectionEyebrow')}
            title={t('tabs.sectionHeadline')}>
            {t('tabs.sectionLede')}
          </SectionHeaderMolecule>

          <SegmentedControlMolecule
            className={styles.tabs}
            style={{ '--stagger-index': 7 } as React.CSSProperties}
            semantics='tabs'
            size='md'
            shape='pill'
            ariaLabel={t('tabs.ariaLabel')}
            value={activeTab}
            onChange={setActiveTab}
            options={TABS.map(tab => ({
              value: tab.key,
              id: `tab-${tab.key}`,
              controls: `tabpanel-${tab.key}`,
              label: t(tab.labelKey),
            }))}
          />

          <HelpCenterAccordionMolecule
            activeTab={activeTab}
            searchQuery={searchQuery}
          />
        </section>

        {/* ─── 6. Contact CTA footer (Vercel-style) ─── */}
        <ContactFooterOrganism />

        {/* ─── 7. Bottom CTA ─── */}
        <BottomCtaOrganism />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withCtaTracking(
            'help-center-sticky',
            () => void router.push(ROUTES_FRONT.CONTACT)
          )}
        />
      </div>
    </PublicLayoutComposition>
  );
}
