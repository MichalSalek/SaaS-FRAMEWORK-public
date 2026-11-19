import type { CSSProperties } from 'react';
import Image from 'next/image';
import { ArrowRightIcon, ClockIcon } from '@phosphor-icons/react';
import type { BlogPost } from '../../../application/blog/blog.types';
import { buildRoute } from '../../../application/routing/buildRoute';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { refreshedAsset } from '../../assets/brandAssets';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import styles from './BlogPostCard.module.css';

interface BlogPostCardProps {
  post: BlogPost;
  index: number;
  categoryLabel: string;
  readingTimeLabel: string;
  titleAs?: 'h3' | 'h4';
  imageSizes?: string;
}

export function BlogPostCardOrganism({
  post,
  index,
  categoryLabel,
  readingTimeLabel,
  titleAs: Title = 'h3',
  imageSizes = '(max-width: 480px) 100vw, (max-width: 640px) 50vw, (max-width: 1280px) 33vw, 380px',
}: BlogPostCardProps) {
  return (
    <AppLinkAtom
      href={buildRoute(ROUTES_FRONT.BLOG_POST, { slug: post.slug })}
      className={styles.cardLink}
      style={{ '--stagger-index': index } as CSSProperties}>
      <article className={styles.blogCard}>
        <div className={styles.cardImage} aria-hidden='true'>
          {post.coverImage ? (
            <Image
              src={refreshedAsset(post.coverImage)}
              alt=''
              fill
              quality={90}
              sizes={imageSizes}
              style={{ objectFit: 'cover' }}
            />
          ) : null}
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardMeta}>
            <span className={styles.categoryBadge}>{categoryLabel}</span>
            <span className={styles.cardMetaDot} aria-hidden='true' />
            <span className={styles.metaItem}>
              <ClockIcon size={12} aria-hidden='true' />
              {readingTimeLabel}
            </span>
          </div>
          <Title className={styles.cardTitle}>{post.title}</Title>
          <p className={styles.cardExcerpt}>{post.description}</p>
          <div className={styles.cardFooter}>
            <span className={styles.cardDate}>{post.date}</span>
            <span className={styles.cardReadMore} aria-hidden='true'>
              <ArrowRightIcon size={14} />
            </span>
          </div>
        </div>
      </article>
    </AppLinkAtom>
  );
}
