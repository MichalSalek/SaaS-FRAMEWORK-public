import { refreshedAsset } from '../../assets/brandAssets';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import Image from 'next/image';
import { CalendarIcon, ClockIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { buildRoute } from '../../../application/routing/buildRoute';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import type { BlogPost } from '../../../application/blog/blog.types';
import { BLOG_CATEGORIES } from '../../../content/blog/categories.config';
import { NewsletterInlineFormOrganism } from '../shared/newsletter/NewsletterInlineForm.organism';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import styles from './BlogListPage.module.css';

/* ─── Props ─── */

export interface BlogListPageProps {
  posts: BlogPost[];
}

/* ─── Component ─── */

export function BlogListPageComposition({ posts }: BlogListPageProps) {
  const t = useTranslations('blog.list');
  const tCat = useTranslations('blog.category');

  const activeCategories = BLOG_CATEGORIES.filter(cat =>
    posts.some(p => p.category === cat)
  );

  // Featured = newest post (first in sorted list). Rest = "Latest" grid.
  const [featured, ...rest] = posts;

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <EyebrowAtom variant='chip'>{t('eyebrow')}</EyebrowAtom>
            <TypographyAtom variant='h1' className={styles.heroTitle}>
              {t('hero.title')}
            </TypographyAtom>
            <TypographyAtom variant='body1' className={styles.heroLede}>
              {t('hero.subtitle')}
            </TypographyAtom>
          </div>
        </section>

        {/* ─── 2. FEATURED — asymmetric editorial card ─── */}
        {posts.length > 0 && featured !== undefined ? (
          <section
            className={styles.featuredSection}
            aria-label={t('featured.label')}>
            <Link
              href={buildRoute(ROUTES_FRONT.BLOG_POST, { slug: featured.slug })}
              className={styles.featuredCard}>
              <div className={styles.featuredImage} aria-hidden='true'>
                {featured.coverImage ? (
                  <Image
                    src={refreshedAsset(featured.coverImage)}
                    alt=''
                    fill
                    priority
                    quality={90}
                    sizes='(max-width: 480px) 100vw, (max-width: 880px) 100vw, 55vw'
                    style={{ objectFit: 'cover' }}
                  />
                ) : null}
              </div>
              <div className={styles.featuredBody}>
                <span className={styles.featuredBadge}>
                  {t('featured.label')}
                </span>
                <span className={styles.featuredCategory}>
                  {tCat(`labels.${featured.category}`)}
                </span>
                <h2 className={styles.featuredTitle}>{featured.title}</h2>
                <p className={styles.featuredExcerpt}>{featured.description}</p>
                <div className={styles.featuredMeta}>
                  <span className={styles.metaItem}>
                    <CalendarIcon size={13} aria-hidden='true' />
                    {featured.date}
                  </span>
                  <span className={styles.metaDivider} aria-hidden='true' />
                  <span className={styles.metaItem}>
                    <ClockIcon size={13} aria-hidden='true' />
                    {t('readingTime', { minutes: featured.readingTime })}
                  </span>
                </div>
                <span className={styles.featuredCta}>
                  {t('featured.readArticle')}
                  <ArrowRightIcon size={16} aria-hidden='true' />
                </span>
              </div>
            </Link>
          </section>
        ) : null}

        {/* ─── 3. CATEGORY FILTER ─── */}
        {activeCategories.length > 0 ? (
          <section className={styles.filterSection}>
            <span className={styles.filterLabel}>
              {t('categoryFilter.label')}
            </span>
            <nav
              className={styles.categories}
              aria-label={t('categoryFilter.ariaLabel')}>
              <Link
                href={ROUTES_FRONT.BLOG}
                className={styles.categoryLink}
                data-active='true'>
                {t('categoryFilter.all')}
              </Link>
              {activeCategories.map(cat => (
                <Link
                  key={cat}
                  href={buildRoute(ROUTES_FRONT.BLOG_CATEGORY, {
                    category: cat,
                  })}
                  className={styles.categoryLink}>
                  {tCat(`labels.${cat}`)}
                </Link>
              ))}
            </nav>
          </section>
        ) : null}

        {/* ─── 4. LATEST GRID ─── */}
        {rest.length > 0 ? (
          <section className={styles.latestSection}>
            <header className={styles.sectionHeader}>
              {/* B1-F8: h2 for correct heading hierarchy (h1 hero → h2 section → h3 cards).
               * Styled as the eyebrow pill — semantic heading with decorative presentation. */}
              <EyebrowAtom as='h2' variant='chip'>
                {t('sectionLatest.label')}
              </EyebrowAtom>
              <p className={styles.sectionSubtitle}>
                {t('sectionLatest.subtitle')}
              </p>
            </header>
            <div className={styles.blogGrid}>
              {rest.map((post, i) => (
                <Link
                  key={post.slug}
                  href={buildRoute(ROUTES_FRONT.BLOG_POST, { slug: post.slug })}
                  className={styles.cardLink}
                  style={{ '--stagger-index': i } as React.CSSProperties}>
                  <article className={styles.blogCard}>
                    <div className={styles.cardImage} aria-hidden='true'>
                      {post.coverImage ? (
                        <Image
                          src={refreshedAsset(post.coverImage)}
                          alt=''
                          fill
                          quality={90}
                          sizes='(max-width: 480px) 100vw, (max-width: 640px) 50vw, (max-width: 1280px) 33vw, 380px'
                          style={{ objectFit: 'cover' }}
                        />
                      ) : null}
                    </div>
                    <div className={styles.cardBody}>
                      <div className={styles.cardMeta}>
                        <span className={styles.categoryBadge}>
                          {tCat(`labels.${post.category}`)}
                        </span>
                        <span
                          className={styles.cardMetaDot}
                          aria-hidden='true'
                        />
                        <span className={styles.metaItem}>
                          <ClockIcon size={12} aria-hidden='true' />
                          {t('readingTime', { minutes: post.readingTime })}
                        </span>
                      </div>
                      <h3 className={styles.cardTitle}>{post.title}</h3>
                      <p className={styles.cardExcerpt}>{post.description}</p>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardDate}>{post.date}</span>
                        <span
                          className={styles.cardReadMore}
                          aria-hidden='true'>
                          <ArrowRightIcon size={14} />
                        </span>
                      </div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* ─── 5. NEWSLETTER — slim editorial band ─── */}
        <section
          className={styles.newsletter}
          aria-labelledby='newsletter-title'>
          <div className={styles.newsletterInner}>
            <div className={styles.newsletterText}>
              <EyebrowAtom variant='chip'>
                {t('newsletter.eyebrow')}
              </EyebrowAtom>
              <h2 id='newsletter-title' className={styles.newsletterTitle}>
                {t('newsletter.title')}
              </h2>
              <p className={styles.newsletterDescription}>
                {t('newsletter.description')}
              </p>
            </div>
            <NewsletterInlineFormOrganism
              consentSource='blog'
              placeholder={t('newsletter.placeholder')}
              ctaLabel={t('newsletter.cta')}
              privacyNote={t('newsletter.privacy')}
              successMessage={t('newsletter.successMessage')}
              errorMessage={t('newsletter.errorMessage')}
              consentLabel={t.rich('newsletter.consent', {
                privacyLink: chunks => (
                  <Link
                    prefetch={false}
                    href={ROUTES_FRONT.PRIVACY}
                    className={styles.newsletterConsentLink}>
                    {chunks}
                  </Link>
                ),
              })}
              classNames={{
                form: styles.newsletterForm,
                row: styles.newsletterRow,
                inputWrap: styles.newsletterInputWrap,
                input: styles.newsletterInput,
                submitButton: styles.newsletterCta,
                consent: styles.newsletterConsent,
                consentText: styles.newsletterConsentText,
                privacyNote: styles.newsletterPrivacy,
                successMessage: styles.newsletterPrivacy,
                srOnly: styles.srOnly,
              }}
            />
          </div>
        </section>

        {/* ─── EMPTY STATE ─── */}
        {posts.length === 0 ? (
          <div className={styles.emptyState}>
            <TypographyAtom variant='h3' align='center'>
              {t('empty.title')}
            </TypographyAtom>
            <TypographyAtom
              variant='body1'
              align='center'
              className={styles.emptySubtext}>
              {t('empty.subtitle')}
            </TypographyAtom>
          </div>
        ) : null}
      </div>
    </PublicLayoutComposition>
  );
}
