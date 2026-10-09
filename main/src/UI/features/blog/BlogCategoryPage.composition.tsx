import { refreshedAsset } from '../../assets/brandAssets';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import Image from 'next/image';
import {
  CalendarIcon,
  ClockIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import type { BlogPost } from '../../../application/blog/blog.types';
import {
  BLOG_CATEGORIES,
  type BlogCategory,
} from '../../../content/blog/categories.config';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import styles from './BlogCategoryPage.module.css';

/* ─── Props ─── */

export interface BlogCategoryPageProps {
  category: BlogCategory;
  posts: BlogPost[];
}

/* ─── Component ─── */

export function BlogCategoryPageComposition({
  category,
  posts,
}: BlogCategoryPageProps) {
  const t = useTranslations('blog.category');
  const categoryLabel = t(`labels.${category}`);
  const categoryDescription = t(`descriptions.${category}`);
  const postCount = posts.length;

  // Sibling categories for chip nav (current category highlighted)
  const siblings = BLOG_CATEGORIES;

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO — category cover ─── */}
        <header className={styles.hero}>
          <div className={styles.heroInner}>
            {/* Breadcrumb */}
            <nav className={styles.breadcrumb} aria-label='Breadcrumb'>
              <Link href={ROUTES_FRONT.BLOG} className={styles.breadcrumbLink}>
                {t('breadcrumbBlog')}
              </Link>
              <span className={styles.breadcrumbSep} aria-hidden='true'>
                {t('breadcrumbSeparator')}
              </span>
              <span className={styles.breadcrumbCurrent}>{categoryLabel}</span>
            </nav>

            {/* Eyebrow chip */}
            <EyebrowAtom variant='chip'>{t('eyebrow')}</EyebrowAtom>

            {/* Title */}
            <h1 className={styles.heroTitle}>{categoryLabel}</h1>

            {/* Category description (editorial) */}
            <p className={styles.heroLede}>{categoryDescription}</p>

            {/* Post count */}
            <p className={styles.heroCount}>
              {t('postCount', { count: postCount })}
            </p>
          </div>
        </header>

        {/* ─── 2. SIBLING CATEGORY CHIPS ─── */}
        <section className={styles.siblingsSection}>
          <nav className={styles.siblings} aria-label='Inne kategorie'>
            <Link href={ROUTES_FRONT.BLOG} className={styles.siblingLink}>
              <ArrowLeftIcon size={14} aria-hidden='true' />
              {t('backLink')}
            </Link>
            <span className={styles.siblingsDivider} aria-hidden='true' />
            {siblings.map(cat => (
              <Link
                key={cat}
                href={buildRoute(ROUTES_FRONT.BLOG_CATEGORY, { category: cat })}
                className={styles.siblingLink}
                data-active={cat === category ? 'true' : 'false'}>
                {t(`labels.${cat}`)}
              </Link>
            ))}
          </nav>
        </section>

        {/* ─── 3. POSTS GRID ─── */}
        {postCount > 0 ? (
          <section className={styles.postsSection}>
            <div className={styles.blogGrid}>
              {posts.map((post, i) => (
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
                        <span className={styles.metaItem}>
                          <CalendarIcon size={12} aria-hidden='true' />
                          {post.date}
                        </span>
                        <span
                          className={styles.metaDivider}
                          aria-hidden='true'
                        />
                        <span className={styles.metaItem}>
                          <ClockIcon size={12} aria-hidden='true' />
                          {post.readingTime} min
                        </span>
                      </div>
                      <h2 className={styles.cardTitle}>{post.title}</h2>
                      <p className={styles.cardExcerpt}>{post.description}</p>
                      <span className={styles.readMore}>
                        {t('readMore')}
                        <ArrowRightIcon size={14} aria-hidden='true' />
                      </span>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <div className={styles.emptyState}>
            <TypographyAtom
              variant='h3'
              align='center'
              className={styles.emptyTitle}>
              {t('empty.title')}
            </TypographyAtom>
            <TypographyAtom variant='body2' className={styles.emptyText}>
              {t('empty.subtitle')}
            </TypographyAtom>
            <Link href={ROUTES_FRONT.BLOG} className={styles.emptyBackLink}>
              <ArrowLeftIcon size={14} aria-hidden='true' />
              {t('empty.backLink')}
            </Link>
          </div>
        )}
      </div>
    </PublicLayoutComposition>
  );
}
