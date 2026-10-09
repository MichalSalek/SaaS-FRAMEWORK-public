import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
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

export const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'general', labelKey: 'tabs.general' },
  { key: 'stylists', labelKey: 'tabs.stylists' },
  { key: 'clients', labelKey: 'tabs.clients' },
  { key: 'technical', labelKey: 'tabs.technical' },
];

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
}

/**
 * DECISION (nie usuwaj tego komentarza):
 * Panel ZAWSZE w DOM (warunkowy render zastąpiony data-open). Animacja otwarcia
 * grid-template-rows 0fr→1fr w HelpCenterPage.module.css (sekcja .accordionPanel).
 * Wzorzec per Accordion.module.css — visibility z opóźnieniem usuwa treść z
 * tab-orderu po zwinięciu bez twardego display:none (Style Policy §5).
 * ID prefiksowane tabKey: wszystkie 4 panele zakładek renderują się naraz
 * (patrz DECISION w HelpCenterAccordionMolecule), więc sam index nie jest
 * unikalny w obrębie strony — kolizja faq-trigger-0 × 4 bez prefiksu.
 */
function AccordionItem({
  tabKey,
  question,
  answer,
  index,
}: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `faq-${tabKey}-panel-${index}`;
  const triggerId = `faq-${tabKey}-trigger-${index}`;

  return (
    <div
      className={styles.accordionItem}
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
      <div
        id={panelId}
        role='region'
        aria-labelledby={triggerId}
        className={styles.accordionPanel}
        data-open={isOpen || undefined}>
        <div className={styles.accordionPanelClip}>
          <div className={styles.accordionContent}>
            <TypographyAtom variant='body2'>{answer}</TypographyAtom>
          </div>
        </div>
      </div>
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
 * Single tab's FAQ list with empty state. Rendered for EVERY tab (patrz
 * DECISION w HelpCenterAccordionMolecule); nieaktywny panel dostaje atrybut
 * `hidden` — treść zostaje w DOM dla crawlera, ale wypada z a11y-tree i
 * tab-orderu. Search obejmuje WSZYSTKIE kategorie: w trakcie wyszukiwania
 * widoczny jest każdy panel z trafieniami (pusty stan tylko na aktywnym).
 */
function FaqTabPanel({
  tabKey,
  isActive,
  searchQuery,
  hasMatchesElsewhere,
}: FaqTabPanelProps) {
  const t = useTranslations('static.helpCenter');
  const allFaqKeys = FAQ_DATA[tabKey] ?? [];
  // Search spans ALL categories: a popular-search tag used to filter only the
  // active tab, so an answer living in another category came back as „no
  // results". While searching, every panel with matches is shown; panels
  // without matches stay hidden. The empty state belongs to the active panel
  // ONLY when no category matches: before, the active tab announced „no
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
      role='tabpanel'
      aria-labelledby={`tab-${tabKey}`}
      hidden={!visible}>
      {filteredFaqs.length > 0 ? (
        filteredFaqs.map((item, i) => (
          <AccordionItem
            key={item.question}
            tabKey={tabKey}
            question={item.question}
            answer={item.answer}
            index={i}
          />
        ))
      ) : (
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
 * FAQ accordion — renderuje panele WSZYSTKICH zakładek do DOM jednocześnie,
 * dzięki czemu FAQPage JSON-LD (40 Q&A z każdej kategorii) odpowiada 1:1
 * treści w markup, niezależnie od aktywnej zakładki.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Wszystkie 4 panele zakładek są ZAWSZE w DOM; nieaktywne dostają atrybut
 * `hidden` (CSS `.faqSection[hidden] { display: none }` — bez tej reguły
 * autor-CSS `display: flex` na .faqSection zbiłby natywne [hidden]). Powód:
 * Google FAQ policy wymaga, by structured data odpowiadała treści W markup.
 * Poprzedni render tylko aktywnej zakładki (mount/unmount na klik) zostawiał
 * 28 z 40 Q&A poza HTML → mismatch 40≠12 (ryzyko utraty rich result / manual
 * action). `hidden` trzyma treść w DOM dla crawlera i jednocześnie usuwa ją z
 * a11y-tree + tab-orderu, gdy zakładka nieaktywna (WAI-ARIA APG tabs pattern).
 * UX bez zmian: wizualnie widać tylko aktywną zakładkę.
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
