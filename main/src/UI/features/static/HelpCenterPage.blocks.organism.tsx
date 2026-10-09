import { useTranslations } from 'next-intl';
import {
  type Icon as PhosphorIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CreditCardIcon,
  GearIcon,
  HeartIcon,
  QrCodeIcon,
  StorefrontIcon,
} from '@phosphor-icons/react';
import { FAQ_DATA, type TabKey } from './HelpCenterAccordion.molecule';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import styles from './HelpCenterPage.module.css';

/* ─── Categories config (key-based) ─── */

interface CategoryConfig {
  /** Stable id used for stagger + aria. */
  id: string;
  /** Translation key under `categories.items.<key>`. */
  key: string;
  /** Phosphor duotone icon. */
  icon: PhosphorIcon;
  /** Article count for the badge — either tab FAQ length or static estimate. */
  count: number;
  /** Anchor for in-page scroll (FAQ tab or contact). */
  href: string;
  /** Map to FAQ tab when clicked (if applicable). */
  tab?: TabKey;
  /**
   * Accent tier within the charcoal-gold family (data-attribute → CSS var
   * swap). Single hue palette — cards differ by tint intensity / gold↔ink
   * tone, never by foreign hues (Style Policy: palettes.css = SSOT barwy).
   */
  accent: 'gold' | 'gold-deep' | 'gold-soft' | 'ink' | 'gold-solid';
}

/**
 * 6-card category grid.
 * DECISION (nie usuwaj tego komentarza):
 * Article counts mix FAQ_DATA.length (where tab maps 1:1) and static
 * estimates (subscription/pairing don't have dedicated tabs but pull from
 * stylists+general). The static values are conservative counts of the
 * actually-existing subscription/pairing FAQs across those tabs — kept at
 * or below the real number so the badge never over-promises ("8 questions"
 * that redirect to fewer). Re-check when adding subscription/pairing FAQs.
 */
const CATEGORIES: CategoryConfig[] = [
  {
    id: 'general',
    key: 'general',
    icon: BookOpenIcon,
    count: FAQ_DATA.general.length,
    href: '#faq',
    tab: 'general',
    accent: 'gold',
  },
  {
    id: 'stylists',
    key: 'stylists',
    icon: StorefrontIcon,
    count: FAQ_DATA.stylists.length,
    href: '#faq',
    tab: 'stylists',
    accent: 'ink',
  },
  {
    id: 'clients',
    key: 'clients',
    icon: HeartIcon,
    count: FAQ_DATA.clients.length,
    href: '#faq',
    tab: 'clients',
    accent: 'gold-soft',
  },
  {
    id: 'technical',
    key: 'technical',
    icon: GearIcon,
    count: FAQ_DATA.technical.length,
    href: '#faq',
    tab: 'technical',
    accent: 'gold-deep',
  },
  {
    id: 'subscription',
    key: 'subscription',
    icon: CreditCardIcon,
    count: 6,
    href: '#faq',
    tab: 'stylists',
    accent: 'gold',
  },
  {
    id: 'pairing',
    key: 'pairing',
    icon: QrCodeIcon,
    count: 5,
    href: '#faq',
    tab: 'general',
    // QR na pełnym złocie — najmocniejszy biegun skali, celowo w rogu siatki.
    accent: 'gold-solid',
  },
];

interface CategoriesGridProps {
  onCategoryClick: (tab: TabKey) => void;
}

export function CategoriesGridOrganism({
  onCategoryClick,
}: CategoriesGridProps) {
  const t = useTranslations('static.helpCenter');

  return (
    <section
      className={styles.categoriesSection}
      aria-label={t('categories.headline')}>
      <SectionHeaderMolecule
        align='center'
        className={styles.helpHeader}
        eyebrow={t('categories.eyebrow')}
        title={t('categories.headline')}>
        {t('categories.lede')}
      </SectionHeaderMolecule>

      {/* DECISION (nie usuwaj tego komentarza):
          categoryCard NIE migruje na kanon NavCard. Każda karta ma per-kategoria
          data-accent={cat.accent} (5 wariantów koloru chip-ikony = wizualna
          orientacja po 6 domenach) + --stagger-index (animacja) + duotone weight
          ikony — żadne nie wychodzi przez props NavCard (jeden gold chip). Migracja
          = utrata rozróżnienia kategorii. Strzałka/hover/href = identyczne z NavCard,
          ale tint-per-item to celowa funkcja, nie slop. */}
      <div className={styles.categoriesGrid}>
        {CATEGORIES.map((cat, i) => {
          const Icon = cat.icon;
          return (
            <a
              key={cat.id}
              // Deep-linkable href (open in new tab / no JS): the page reads
              // `?tab=` on mount, a bare `#faq` landed on the default tab.
              href={cat.tab ? `?tab=${cat.tab}${cat.href}` : cat.href}
              data-accent={cat.accent}
              className={styles.categoryCard}
              style={{ '--stagger-index': i + 2 } as React.CSSProperties}
              onClick={e => {
                if (cat.tab) {
                  e.preventDefault();
                  onCategoryClick(cat.tab);
                  const faqEl = document.getElementById('faq');
                  if (faqEl) {
                    faqEl.scrollIntoView({ behavior: 'smooth' });
                  }
                }
              }}>
              <span className={styles.categoryIconWrap} aria-hidden='true'>
                <Icon size={26} weight='duotone' />
              </span>
              <div className={styles.categoryBody}>
                <h3 className={styles.categoryTitle}>
                  {t(`categories.items.${cat.key}.title`)}
                </h3>
                <p className={styles.categoryDescription}>
                  {t(`categories.items.${cat.key}.description`)}
                </p>
                <span className={styles.categoryMeta}>
                  {t('categories.articleCount', { count: cat.count })}
                  <ArrowRightIcon
                    size={14}
                    weight='bold'
                    className={styles.categoryArrow}
                    aria-hidden='true'
                  />
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/* ─── Popular articles (Linear-style numbered list with read time) ─── */

interface PopularArticleConfig {
  key: string;
  /** Anchor jump target (FAQ tab) — keeps articles in the FAQ flow. */
  tab: TabKey;
  /** Article ordering — used for the Marcellus numeral. */
  ordinal: number;
  /**
   * Read time in minutes.
   * DECISION (nie usuwaj tego komentarza):
   * To liczba-DANE (2 jest "2" w kazdym jezyku), nie tlumaczenie. Trzymana w configu,
   * NIE jako klucz i18n — numeryczny klucz w common.json powodowal 15x INVALID_MESSAGE
   * przy SSG (next-intl wymaga, by komunikaty byly stringami; TQM-I18N-2). Liczba zyje
   * tu, a tlumaczony sufiks ("min czytania"/"min read") w kluczu readTimeMinutes (ICU arg).
   */
  readTime: number;
}

const POPULAR_ARTICLES: PopularArticleConfig[] = [
  { key: 'qr', tab: 'stylists', ordinal: 1, readTime: 2 },
  { key: 'session', tab: 'clients', ordinal: 2, readTime: 3 },
  { key: 'pricing', tab: 'stylists', ordinal: 3, readTime: 2 },
  { key: 'addPhoto', tab: 'stylists', ordinal: 4, readTime: 3 },
  { key: 'safety', tab: 'general', ordinal: 5, readTime: 2 },
];

interface PopularArticlesProps {
  onArticleClick: (tab: TabKey) => void;
}

export function PopularArticlesOrganism({
  onArticleClick,
}: PopularArticlesProps) {
  const t = useTranslations('static.helpCenter');

  return (
    <section
      className={styles.popularSection}
      aria-label={t('popularArticles.headline')}>
      <SectionHeaderMolecule
        align='center'
        className={styles.helpHeader}
        eyebrow={t('popularArticles.eyebrow')}
        title={t('popularArticles.headline')}>
        {t('popularArticles.lede')}
      </SectionHeaderMolecule>

      <ul className={styles.popularList}>
        {POPULAR_ARTICLES.map((art, i) => (
          <li
            key={art.key}
            className={styles.popularItem}
            style={{ '--stagger-index': i + 2 } as React.CSSProperties}>
            <a
              href='#faq'
              className={styles.popularLink}
              onClick={e => {
                e.preventDefault();
                onArticleClick(art.tab);
                const faqEl = document.getElementById('faq');
                if (faqEl) {
                  faqEl.scrollIntoView({ behavior: 'smooth' });
                }
              }}>
              <div className={styles.popularBody}>
                <span className={styles.popularCategory}>
                  {t(`popularArticles.items.${art.key}.category`)}
                </span>
                <h3 className={styles.popularTitle}>
                  {t(`popularArticles.items.${art.key}.title`)}
                </h3>
                <span className={styles.popularMeta}>
                  {t('popularArticles.readTimeMinutes', {
                    minutes: art.readTime,
                  })}
                </span>
              </div>
              <ArrowRightIcon
                size={18}
                weight='regular'
                className={styles.popularArrow}
                aria-hidden='true'
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
