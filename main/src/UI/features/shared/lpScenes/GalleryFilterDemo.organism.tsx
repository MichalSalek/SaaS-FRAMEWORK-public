// UI/features/shared/lpScenes/GalleryFilterDemo.organism.tsx
// A small playable gallery for public pages: tap a filter, the works that
// match glide to the front and the rest fade. It is the product's core
// mechanic (a portfolio a client filters), shown instead of described.
//
// DECISION: public pages need sections that DO something; a carousel was rejected (motion without
// content, and almost nobody looks past the first slide). Rules:
//  - a filter never changes the grid height: non-matching works fade and yield, never disappear;
//  - photos are decoration (empty `alt`), the counter (`aria-live`) states the result;
//  - chips are the shared `ChipAtom` with inverted-ink selection.
// (owner)

import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { ChipAtom } from '../../../components/Chip/Chip.atom';
import { trackDemoInteraction } from '../../../../application/analytics/cta-events';
import { DEMO_TAGS, DEMO_WORKS, type DemoTag } from './galleryFilterDemo.data';
import { useFlipReorder } from './useFlipReorder';
import styles from './GalleryFilterDemo.module.css';

interface GalleryFilterDemoProps {
  /** `section`: twelve works. `hero`: six, for a hero's media slot. */
  size?: 'section' | 'hero';
  className?: string;
}

const HERO_WORKS = 6;

export function GalleryFilterDemoOrganism({
  size = 'section',
  className,
}: GalleryFilterDemoProps) {
  const t = useTranslations('components.lpScenes.galleryDemo');
  const [tag, setTag] = useState<DemoTag | null>(null);
  const gridRef = useRef<HTMLUListElement>(null);

  const works = size === 'hero' ? DEMO_WORKS.slice(0, HERO_WORKS) : DEMO_WORKS;
  const tags = useMemo(
    () => DEMO_TAGS.filter(key => works.some(work => work.tags.includes(key))),
    [works]
  );
  const ordered = useMemo(() => {
    if (tag === null) {
      return works;
    }
    return [
      ...works.filter(work => work.tags.includes(tag)),
      ...works.filter(work => !work.tags.includes(tag)),
    ];
  }, [tag, works]);
  const matching =
    tag === null
      ? works.length
      : works.filter(work => work.tags.includes(tag)).length;

  useFlipReorder(gridRef, tag ?? 'all');

  return (
    <div className={clsx(styles.demo, className)} data-size={size}>
      <div className={styles.bar}>
        <div
          className={styles.chips}
          role='group'
          aria-label={t('filtersLabel')}>
          <ChipAtom
            label={t('all')}
            selected={tag === null}
            onClick={() => {
              trackDemoInteraction('gallery-filter', 'filter_tap', 'all');
              setTag(null);
            }}
          />
          {tags.map(key => (
            <ChipAtom
              key={key}
              label={t(`tags.${key}`)}
              selected={tag === key}
              onClick={() => {
                // The measure of „does she play with it”: once per chip per
                // page view (the function keeps that promise itself).
                trackDemoInteraction('gallery-filter', 'filter_tap', key);
                setTag(current => (current === key ? null : key));
              }}
            />
          ))}
        </div>
        <p className={styles.count} aria-live='polite'>
          {t('count', { count: matching, total: works.length })}
        </p>
      </div>
      <ul className={styles.grid} ref={gridRef} aria-label={t('listLabel')}>
        {ordered.map(work => (
          <li
            key={work.id}
            className={styles.tile}
            data-flip-id={work.id}
            data-dim={
              tag !== null && !work.tags.includes(tag) ? 'true' : undefined
            }>
            <Image
              src={work.src}
              alt=''
              fill
              sizes='(max-width: 599px) 33vw, (max-width: 959px) 25vw, 200px'
              // The hero variant is the first screen of /for-stylists on a
              // computer (its LCP was a lazy tile, RDS F5.2 2026-10-18), so it
              // loads at once; the section variant stays lazy below the fold.
              loading={size === 'hero' ? 'eager' : 'lazy'}
              className={styles.photo}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
