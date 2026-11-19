import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { DisclosurePanelAtom } from '../../components/Disclosure/DisclosurePanel.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import {
  isHelpSearchActive,
  matchesHelpQuery,
} from './HelpCenterSearch.helpers';
import styles from './HelpCenterPage.module.css';

/* ─── Types ─── */

export type TabKey = 'general' | 'stylists' | 'clients' | 'technical';

export interface FaqItemKeys {
  questionKey: string;
  answerKey: string;
}

/* ─── FAQ Data (key-based) ─── */

export const TABS = [
  { key: 'general', labelKey: 'tabs.general' },
  { key: 'stylists', labelKey: 'tabs.stylists' },
  { key: 'clients', labelKey: 'tabs.clients' },
  { key: 'technical', labelKey: 'tabs.technical' },
] as const satisfies readonly { key: TabKey; labelKey: string }[];

export const FAQ_DATA: Record<TabKey, FaqItemKeys[]> = {
  general: [
    { questionKey: 'faq.general.q1', answerKey: 'faq.general.a1' },
    { questionKey: 'faq.general.q2', answerKey: 'faq.general.a2' },
    { questionKey: 'faq.general.q3', answerKey: 'faq.general.a3' },
    { questionKey: 'faq.general.q4', answerKey: 'faq.general.a4' },
    { questionKey: 'faq.general.q5', answerKey: 'faq.general.a5' },
    { questionKey: 'faq.general.q6', answerKey: 'faq.general.a6' },
    { questionKey: 'faq.general.q7', answerKey: 'faq.general.a7' },
    { questionKey: 'faq.general.q8', answerKey: 'faq.general.a8' },
    { questionKey: 'faq.general.q9', answerKey: 'faq.general.a9' },
    { questionKey: 'faq.general.q10', answerKey: 'faq.general.a10' },
    { questionKey: 'faq.general.q11', answerKey: 'faq.general.a11' },
    { questionKey: 'faq.general.q12', answerKey: 'faq.general.a12' },
  ],
  stylists: [
    { questionKey: 'faq.stylists.q1', answerKey: 'faq.stylists.a1' },
    { questionKey: 'faq.stylists.q2', answerKey: 'faq.stylists.a2' },
    { questionKey: 'faq.stylists.q3', answerKey: 'faq.stylists.a3' },
    { questionKey: 'faq.stylists.q4', answerKey: 'faq.stylists.a4' },
    { questionKey: 'faq.stylists.q5', answerKey: 'faq.stylists.a5' },
    { questionKey: 'faq.stylists.q6', answerKey: 'faq.stylists.a6' },
    { questionKey: 'faq.stylists.q7', answerKey: 'faq.stylists.a7' },
    { questionKey: 'faq.stylists.q8', answerKey: 'faq.stylists.a8' },
    { questionKey: 'faq.stylists.q9', answerKey: 'faq.stylists.a9' },
    { questionKey: 'faq.stylists.q10', answerKey: 'faq.stylists.a10' },
    { questionKey: 'faq.stylists.q11', answerKey: 'faq.stylists.a11' },
    { questionKey: 'faq.stylists.q12', answerKey: 'faq.stylists.a12' },
    { questionKey: 'faq.stylists.q13', answerKey: 'faq.stylists.a13' },
    { questionKey: 'faq.stylists.q14', answerKey: 'faq.stylists.a14' },
  ],
  clients: [
    { questionKey: 'faq.clients.q1', answerKey: 'faq.clients.a1' },
    { questionKey: 'faq.clients.q2', answerKey: 'faq.clients.a2' },
    { questionKey: 'faq.clients.q3', answerKey: 'faq.clients.a3' },
    { questionKey: 'faq.clients.q4', answerKey: 'faq.clients.a4' },
    { questionKey: 'faq.clients.q5', answerKey: 'faq.clients.a5' },
    { questionKey: 'faq.clients.q6', answerKey: 'faq.clients.a6' },
    { questionKey: 'faq.clients.q7', answerKey: 'faq.clients.a7' },
    { questionKey: 'faq.clients.q8', answerKey: 'faq.clients.a8' },
    { questionKey: 'faq.clients.q9', answerKey: 'faq.clients.a9' },
    { questionKey: 'faq.clients.q10', answerKey: 'faq.clients.a10' },
  ],
  technical: [
    { questionKey: 'faq.technical.q1', answerKey: 'faq.technical.a1' },
    { questionKey: 'faq.technical.q2', answerKey: 'faq.technical.a2' },
    { questionKey: 'faq.technical.q3', answerKey: 'faq.technical.a3' },
    { questionKey: 'faq.technical.q4', answerKey: 'faq.technical.a4' },
    { questionKey: 'faq.technical.q5', answerKey: 'faq.technical.a5' },
    { questionKey: 'faq.technical.q6', answerKey: 'faq.technical.a6' },
    { questionKey: 'faq.technical.q7', answerKey: 'faq.technical.a7' },
  ],
};

/* ─── AccordionItem ─── */

interface AccordionItemProps {
  tabKey: TabKey;
  question: string;
  answer: string;
  index: number;
  hidden: boolean;
}

/* Tab key prefixes the ids: all 4 tab panels render at once, so a bare index collides. */
function AccordionItem({
  tabKey,
  question,
  answer,
  index,
  hidden,
}: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `faq-${tabKey}-panel-${index}`;
  const triggerId = `faq-${tabKey}-trigger-${index}`;

  return (
    <div
      className={styles.accordionItem}
      hidden={hidden}
      style={{ '--stagger-index': index + 3 } as React.CSSProperties}>
      <button
        id={triggerId}
        type='button'
        className={styles.accordionTrigger}
        onClick={() => {
          setIsOpen(prev => !prev);
        }}
        aria-expanded={isOpen}
        aria-controls={panelId}>
        <span>{question}</span>
        <CaretDownIcon
          size={18}
          className={styles.accordionChevron}
          data-open={isOpen || undefined}
          aria-hidden='true'
        />
      </button>
      <DisclosurePanelAtom
        id={panelId}
        labelledBy={triggerId}
        open={isOpen}
        className={styles.accordionContent}>
        <TypographyAtom variant='body2'>{answer}</TypographyAtom>
      </DisclosurePanelAtom>
    </div>
  );
}

/* ─── FaqTabPanel ─── */

interface FaqTabPanelProps {
  tabKey: TabKey;
  isActive: boolean;
  searchQuery: string;
  /** Some OTHER tab has matches for the current search. */
  hasMatchesElsewhere: boolean;
}

/**
 * Single tab's FAQ list with empty state. Rendered for EVERY tab (see the
 * DECISION in HelpCenterAccordionMolecule); an inactive panel gets the `hidden`
 * attribute: the content stays in the DOM for crawlers but leaves the a11y tree and
 * the tab order. Search covers ALL categories: while searching,
 * every panel with matches is visible (the empty state only on the active one).
 */
function FaqTabPanel({
  tabKey,
  isActive,
  searchQuery,
  hasMatchesElsewhere,
}: FaqTabPanelProps) {
  const t = useTranslations('static.helpCenter');
  const allFaqKeys = FAQ_DATA[tabKey] ?? [];
  // Search spans ALL categories: a popular-search tag filtering only the
  // active tab would make an answer living in another category come back as „no
  // results". While searching, every panel with matches is shown; panels
  // without matches stay hidden. The empty state belongs to the active panel
  // ONLY when no category matches, otherwise the active tab would announce „no
  // results for X" right above the matches found in the other tabs.
  const searching = isHelpSearchActive(searchQuery);

  const allFaqs = allFaqKeys.map(item => ({
    question: t(item.questionKey),
    answer: t(item.answerKey),
  }));

  const filteredFaqs = searching
    ? allFaqs.filter(f => matchesHelpQuery(searchQuery, f.question, f.answer))
    : allFaqs;

  const visible = searching
    ? filteredFaqs.length > 0 || (isActive && !hasMatchesElsewhere)
    : isActive;
  return (
    <div
      id={`tabpanel-${tabKey}`}
      className={styles.faqSection}
      role={searching ? undefined : 'tabpanel'}
      aria-labelledby={searching ? undefined : `tab-${tabKey}`}
      hidden={!visible}>
      {allFaqs.map((item, i) => (
        <AccordionItem
          key={item.question}
          tabKey={tabKey}
          question={item.question}
          answer={item.answer}
          index={i}
          hidden={
            searching &&
            !matchesHelpQuery(searchQuery, item.question, item.answer)
          }
        />
      ))}
      {filteredFaqs.length === 0 && (
        <div className={styles.emptyState} role='status'>
          <MagnifyingGlassIcon size={32} aria-hidden='true' />
          <TypographyAtom variant='body1'>
            {t('emptyState.noResults', { query: searchQuery })}
          </TypographyAtom>
          <TypographyAtom variant='body2' className={styles.emptyHint}>
            {t('emptyState.hint')}
          </TypographyAtom>
        </div>
      )}
    </div>
  );
}

/* ─── HelpCenterAccordion ─── */

interface HelpCenterAccordionProps {
  activeTab: TabKey;
  searchQuery: string;
}

/**
 * FAQ accordion: renders the panels of ALL tabs into the DOM at once,
 * so the FAQPage JSON-LD (40 Q&A from every category) matches 1:1 the
 * markup, whatever the active tab.
 *
 * DECISION: all 4 tab panels are ALWAYS in the DOM; inactive ones get `hidden`
 * (`.faqSection[hidden] { display: none }` is needed, the author `display: flex`
 * would beat the native rule). Google's FAQ policy requires the structured data to
 * match the markup, and rendering only the active tab left most Q&A out of the HTML.
 * `hidden` keeps the content for crawlers while removing it from the a11y tree and
 * tab order.
 */
export function HelpCenterAccordionMolecule({
  activeTab,
  searchQuery,
}: HelpCenterAccordionProps) {
  const t = useTranslations('static.helpCenter');
  const searching = isHelpSearchActive(searchQuery);
  const tabsWithMatches = new Set<TabKey>(
    searching
      ? TABS.filter(tab =>
          (FAQ_DATA[tab.key] ?? []).some(item =>
            matchesHelpQuery(
              searchQuery,
              t(item.questionKey),
              t(item.answerKey)
            )
          )
        ).map(tab => tab.key)
      : []
  );
  return (
    <>
      {TABS.map(tab => (
        <FaqTabPanel
          key={tab.key}
          tabKey={tab.key}
          isActive={tab.key === activeTab}
          searchQuery={searchQuery}
          hasMatchesElsewhere={[...tabsWithMatches].some(
            key => key !== tab.key
          )}
        />
      ))}
    </>
  );
}
