import { refreshedAsset } from '../../assets/brandAssets';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import Image from 'next/image';
import Markdown from 'react-markdown';
import type { CSSProperties } from 'react';
import {
  staticAssetDimensions,
  staticAssetWidth,
} from '../../assets/static-asset-size.config';
import { useMemo } from 'react';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import {
  CalendarIcon,
  UserIcon,
  ClockIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from '@phosphor-icons/react';

import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { TypographyAtom } from '../../components/Typography/Typography.atom';

// DECISION (nie usuwaj tego komentarza):
// react-markdown, NIE next-mdx-remote. Ten drugi kompiluje treść do kodu, który
// przeglądarka wykonuje przez `new Function` — a produkcyjne CSP świadomie nie
// ma 'unsafe-eval' (proxy.ts). Serwer oddawał więc pełny artykuł, po czym
// hydracja rzucała EvalError i ErrorBoundary zjadał całą treść: crawler widział
// tekst, czytelniczka pustą stronę. Wpisy to czysty markdown bez JSX, więc cała
// maszyneria MDX była tu zbędna. react-markdown buduje elementy Reacta zamiast
// wykonywać kod, więc nie wymaga ani eval, ani wstrzykiwania HTML.
// Load within the page chunk: the lazy client seam briefly returned null while
// SSG already contained the article, causing a reproducible hydration mismatch.

import type {
  BlogPost,
  BlogPostFull,
} from '../../../application/blog/blog.types';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import styles from './BlogPostPage.module.css';
import { BlogPostCtaOrganism } from './BlogPostCta.organism';

// GFM (tables) for comparison posts. A wide table scrolls inside its own frame
// instead of widening the page on a phone; the frame is a labelled region.
// No tabIndex: current browsers make a scroll container keyboard-focusable on
// their own.
const MARKDOWN_PLUGINS = [remarkGfm];

function buildMarkdownComponents(tableLabel: string): Components {
  return {
    img: ({ node: _node, src, alt }) => {
      if (typeof src !== 'string' || !src) {
        return null;
      }
      const size = staticAssetDimensions(src) ?? { width: 1440, height: 960 };
      return (
        <Image
          src={refreshedAsset(src)}
          alt={alt ?? ''}
          width={size.width}
          height={size.height}
          quality={90}
          sizes='(max-width: 767px) calc(100vw - 48px), 672px'
          style={{
            width: '100%',
            maxWidth: `${size.width / 2}px`,
            height: 'auto',
          }}
        />
      );
    },
    table: ({ node: _node, ...props }) => (
      <div className={styles.tableScroll} role='region' aria-label={tableLabel}>
        <table {...props} />
      </div>
    ),
  };
}

/* ─── Props ─── */

export interface BlogPostPageProps {
  post: BlogPostFull;
  relatedPosts: BlogPost[];
}

/* ─── Component ─── */

export function BlogPostPageComposition({
  post,
  relatedPosts,
}: BlogPostPageProps) {
  const t = useTranslations('blog.post');
  const tCat = useTranslations('blog.category');
  const tableLabel = t('tableRegionLabel');
  const markdownComponents = useMemo(
    () => buildMarkdownComponents(tableLabel),
    [tableLabel]
  );

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO — NYT Magazine cover ─── */}
        <header className={styles.hero}>
          <div className={styles.heroInner}>
            {/* Breadcrumb */}
            <nav className={styles.breadcrumb} aria-label='Breadcrumb'>
              <Link href={ROUTES_FRONT.BLOG} className={styles.breadcrumbLink}>
                {t('eyebrowBlog')}
              </Link>
              <span className={styles.breadcrumbSep} aria-hidden='true'>
                {t('breadcrumbSeparator')}
              </span>
              <Link
                href={ROUTES_FRONT.BLOG_CATEGORY.replace(
                  '[category]',
                  post.category
                )}
                className={styles.breadcrumbLink}>
                {tCat(`labels.${post.category}`)}
              </Link>
            </nav>

            <Link
              href={ROUTES_FRONT.BLOG_CATEGORY.replace(
                '[category]',
                post.category
              )}
              className={styles.categoryChip}>
              {tCat(`labels.${post.category}`)}
            </Link>

            {/* Title — editorial Marcellus */}
            <h1 className={styles.heroTitle}>{post.title}</h1>

            {/* Description / lede */}
            <p className={styles.heroLede}>{post.description}</p>

            {/* Meta line */}
            <div className={styles.meta}>
              <span className={styles.metaItem}>
                <UserIcon size={14} aria-hidden='true' />
                <span className={styles.metaPrefix}>{t('byAuthor')}</span>
                <span className={styles.metaAuthor}>{post.author}</span>
              </span>
              <span className={styles.metaDivider} aria-hidden='true' />
              <span className={styles.metaItem}>
                <CalendarIcon size={14} aria-hidden='true' />
                {post.date}
              </span>
              <span className={styles.metaDivider} aria-hidden='true' />
              <span className={styles.metaItem}>
                <ClockIcon size={14} aria-hidden='true' />
                {t('readingTime', { minutes: post.readingTime })}
              </span>
            </div>
          </div>
        </header>

        {/* ─── 2. COVER IMAGE — wide editorial ─── */}
        <figure
          className={styles.coverFigure}
          style={
            {
              '--cover-native-width': `${staticAssetWidth(post.coverImage, 1440)}px`,
            } as CSSProperties
          }>
          <div className={styles.coverImage}>
            {post.coverImage ? (
              <Image
                src={refreshedAsset(post.coverImage)}
                alt={t('coverImageAriaLabel', { title: post.title })}
                fill
                priority
                quality={90}
                sizes='(max-width: 480px) 100vw, (max-width: 768px) 100vw, (max-width: 1024px) 100vw, 720px'
                style={{ objectFit: 'cover' }}
              />
            ) : null}
          </div>
        </figure>

        {/* ─── 3. ARTICLE BODY ─── */}
        <article className={styles.article}>
          <div className={styles.body}>
            <Markdown
              remarkPlugins={MARKDOWN_PLUGINS}
              components={markdownComponents}>
              {post.content}
            </Markdown>
          </div>

          {/* Domknięcie wpisu: przejście do produktu z ceną wprost. */}
          <BlogPostCtaOrganism />

          {/* Footer: back link */}
          <div className={styles.articleFooter}>
            <Link href={ROUTES_FRONT.BLOG} className={styles.backLink}>
              <ArrowLeftIcon size={16} aria-hidden='true' />
              {t('backLink')}
            </Link>
          </div>
        </article>

        {/* ─── 4. RELATED POSTS ─── */}
        {relatedPosts.length > 0 && (
          <section
            className={styles.relatedSection}
            aria-labelledby='related-heading'>
            <header className={styles.relatedHeader}>
              <EyebrowAtom variant='chip'>
                {t('relatedPosts.label')}
              </EyebrowAtom>
              <TypographyAtom
                variant='h3'
                className={styles.relatedTitle}
                id='related-heading'>
                {t('relatedPosts.title')}
              </TypographyAtom>
              <p className={styles.relatedSubtitle}>
                {t('relatedPosts.subtitle')}
              </p>
            </header>
            <div className={styles.relatedGrid}>
              {relatedPosts.map((related, i) => (
                <Link
                  key={related.slug}
                  href={buildRoute(ROUTES_FRONT.BLOG_POST, {
                    slug: related.slug,
                  })}
                  className={styles.relatedCard}
                  style={{ '--stagger-index': i } as React.CSSProperties}>
                  <div className={styles.relatedImage} aria-hidden='true'>
                    {related.coverImage ? (
                      <Image
                        src={refreshedAsset(related.coverImage)}
                        alt=''
                        fill
                        quality={90}
                        sizes='(max-width: 640px) 100vw, (max-width: 1280px) 33vw, 380px'
                        style={{ objectFit: 'cover' }}
                      />
                    ) : null}
                  </div>
                  <div className={styles.relatedInfo}>
                    <span className={styles.relatedCategory}>
                      {tCat(`labels.${related.category}`)}
                    </span>
                    <h4 className={styles.relatedCardTitle}>{related.title}</h4>
                    <div className={styles.relatedFooter}>
                      <span className={styles.relatedDate}>{related.date}</span>
                      <span className={styles.readMore}>
                        {t('readMore')}{' '}
                        <ArrowRightIcon size={13} aria-hidden='true' />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </PublicLayoutComposition>
  );
}
