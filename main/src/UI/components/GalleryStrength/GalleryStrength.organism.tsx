import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { InfoIcon, XIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { TypographyAtom } from '../Typography/Typography.atom';
import { CardMolecule, CardContentAtom } from '../Card/Card.molecule';
import styles from './GalleryStrength.module.css';

/* ─── Types ─── */

export interface GalleryStrengthProps {
  photoCount: number;
  /** Positive cap, -1 for unlimited; undefined means not yet known. */
  maxPhotos?: number | undefined;
  hasProfileBio: boolean;
  hasProfilePhoto: boolean;
  hasPinnedWork: boolean;
  pairedClientCount: number;
  /**
   * Closes the card. The X appears ONLY at 100%; before that the card carries
   * a task and there is nothing to close (owner). No handler = the card cannot
   * be closed (component library, preview).
   */
  onDismiss?: () => void;
  /**
   * Database flag: the stylist has already closed this card.
   *
   * DECISION: the COMPONENT decides about hiding, not the dashboard, because it computes the
   * score. The dashboard only has the backend score, computed by a DIFFERENT formula (its maximum
   * for the same complete profile is below 100), so "closed AND 100%" checked outside never holds.
   * One score, one place of decision.
   */
  isDismissed?: boolean;
}

interface MissingItem {
  label: string;
  points: number;
  path: string;
  metricKey: string;
  hint: string;
}

/* ─── Algorithm (N6: Endowed Progress — start at 25%) ─── */

// DECISION: ONE weight table feeds both the score and the "+X%" on checklist items, and every
// item adds EXACTLY what it declares (no hidden bonus). Two separate number sets drift: a complete
// profile misses 100 and the `hintComplete` branch ("Twoja galeria jest kompletna") dies.
// The weights sum to 100, enforced by `GalleryStrength.score.test.ts`; changing one weight means
// rebalancing the others. Photo thresholds reveal one at a time on purpose (the checklist leads to
// the next threshold), so visible items sum to the missing points only from 10 photos up.
const STRENGTH_WEIGHTS = {
  /** Endowed progress: the user NEVER starts from zero. */
  BASE: 25,
  PHOTO_1: 5,
  PHOTO_5: 10,
  PHOTO_10: 15,
  BIO: 10,
  PROFILE_PHOTO: 10,
  PINNED_WORK: 10,
  PAIRED_CLIENT: 15,
} as const;

export function getPhotoMilestones(maxPhotos: number | undefined) {
  if (maxPhotos === undefined || maxPhotos === 0 || maxPhotos < -1) {
    return [];
  }
  const cap = maxPhotos === -1 ? 10 : maxPhotos;
  const milestones = [
    { target: Math.min(1, cap), points: STRENGTH_WEIGHTS.PHOTO_1 },
    { target: Math.min(5, cap), points: STRENGTH_WEIGHTS.PHOTO_5 },
    { target: Math.min(10, cap), points: STRENGTH_WEIGHTS.PHOTO_10 },
  ];
  const merged = new Map<number, number>();
  for (const { target, points } of milestones) {
    merged.set(target, (merged.get(target) ?? 0) + points);
  }
  return [...merged].map(([target, points]) => ({ target, points }));
}

export function calculateStrength(props: GalleryStrengthProps): number {
  let score: number = STRENGTH_WEIGHTS.BASE;
  for (const { target, points } of getPhotoMilestones(props.maxPhotos)) {
    if (props.photoCount >= target) {
      score += points;
    }
  }
  if (props.hasProfileBio) {
    score += STRENGTH_WEIGHTS.BIO;
  }
  if (props.hasProfilePhoto) {
    score += STRENGTH_WEIGHTS.PROFILE_PHOTO;
  }
  if (props.hasPinnedWork) {
    score += STRENGTH_WEIGHTS.PINNED_WORK;
  }
  if (props.pairedClientCount >= 1) {
    score += STRENGTH_WEIGHTS.PAIRED_CLIENT;
  }
  return score;
}

/** Sum of weights = the reachable maximum; the test asserts it is 100. */
export const MAX_STRENGTH_SCORE = Object.values(STRENGTH_WEIGHTS).reduce(
  (sum, weight) => sum + weight,
  0
);

type TFn = ReturnType<typeof useTranslations<'galleryStrength'>>;

function getMissingItems(props: GalleryStrengthProps, t: TFn): MissingItem[] {
  const items: MissingItem[] = [];

  const nextPhoto = getPhotoMilestones(props.maxPhotos).find(
    milestone => props.photoCount < milestone.target
  );
  if (nextPhoto) {
    items.push({
      label:
        nextPhoto.target === 1
          ? t('addFirstPhoto')
          : t('addPhotosTarget', { count: nextPhoto.target }),
      points: nextPhoto.points,
      path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
      metricKey: 'photos',
      hint: t('addPhotosHint'),
    });
  }
  if (!props.hasProfileBio) {
    items.push({
      label: t('completeBio'),
      points: STRENGTH_WEIGHTS.BIO,
      // The bio and the profile photo are edited on /app/profile (the account
      // screen has neither field).
      path: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
      metricKey: 'bio',
      hint: t('completeBioHint'),
    });
  }
  if (!props.hasProfilePhoto) {
    items.push({
      label: t('addProfilePhoto'),
      points: STRENGTH_WEIGHTS.PROFILE_PHOTO,
      path: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
      metricKey: 'profilePhoto',
      hint: t('completeBioHint'),
    });
  }
  if (!props.hasPinnedWork) {
    items.push({
      label: t('pinFirstWork'),
      points: STRENGTH_WEIGHTS.PINNED_WORK,
      path: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
      metricKey: 'pinnedWork',
      hint: t('pinFirstWorkHint'),
    });
  }
  if (props.pairedClientCount < 1) {
    items.push({
      label: t('pairFirstClient'),
      points: STRENGTH_WEIGHTS.PAIRED_CLIENT,
      path: ROUTES_FRONT.PAIRING,
      metricKey: 'clients',
      hint: t('pairFirstClientHint'),
    });
  }

  return items;
}

/* ─── SVG Circular Progress ─── */

const CIRCLE_SIZE = 96;
const STROKE_WIDTH = 7;
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function CircularProgress({ value }: { value: number }) {
  const offset = CIRCUMFERENCE - (value / MAX_STRENGTH_SCORE) * CIRCUMFERENCE;

  return (
    <svg
      className={styles.circle}
      width={CIRCLE_SIZE}
      height={CIRCLE_SIZE}
      viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}
      role='progressbar'
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={MAX_STRENGTH_SCORE}>
      <circle
        className={styles.circleTrack}
        cx={CIRCLE_SIZE / 2}
        cy={CIRCLE_SIZE / 2}
        r={RADIUS}
        fill='none'
        strokeWidth={STROKE_WIDTH}
      />
      <circle
        className={styles.circleBar}
        cx={CIRCLE_SIZE / 2}
        cy={CIRCLE_SIZE / 2}
        r={RADIUS}
        fill='none'
        strokeWidth={STROKE_WIDTH}
        strokeLinecap='round'
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

/* ─── Main Component ─── */

export function GalleryStrengthOrganism(props: GalleryStrengthProps) {
  const router = useRouter();
  const t = useTranslations('galleryStrength');
  const score = calculateStrength(props);
  const isComplete = score >= MAX_STRENGTH_SCORE;
  const canDismiss = props.onDismiss !== undefined && isComplete;
  const missingItems = getMissingItems(props, t);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  const toggleMetric = (key: string) => {
    setExpandedMetric(prev => (prev === key ? null : key));
  };

  // A closed card returns when the score drops below 100%: it carries a task
  // again (owner).
  if (props.isDismissed === true && isComplete) {
    return null;
  }

  return (
    <CardMolecule variant='elevated' className={styles.card}>
      <CardContentAtom>
        <div className={styles.header}>
          <div className={styles.circleWrapper}>
            <CircularProgress value={score} />
            <div className={styles.circleLabel}>
              {/* A DATA number: a display serif renders "0" like the letter
                  "O", so the count uses sans + tabular-nums through the
                  global .data-count utility. */}
              <TypographyAtom variant='h3' className={styles.percentValue}>
                <span className='data-count'>{score}%</span>
              </TypographyAtom>
            </div>
          </div>
          <div className={styles.headerText}>
            <TypographyAtom variant='h4'>{t('title')}</TypographyAtom>
            <TypographyAtom variant='caption' className={styles.headerHint}>
              {score < MAX_STRENGTH_SCORE
                ? t('hintIncomplete')
                : t('hintComplete')}
            </TypographyAtom>
          </div>
          {canDismiss && (
            <button
              type='button'
              className={`${styles.dismiss} press-feedback`}
              onClick={props.onDismiss}
              aria-label={t('dismiss')}>
              <XIcon size={18} />
            </button>
          )}
        </div>

        {missingItems.length > 0 && (
          <ul className={styles.checklist}>
            {missingItems.map(item => {
              const isExpanded = expandedMetric === item.metricKey;
              return (
                <li key={item.label} className={styles.checklistItem}>
                  {/* DECISION: the row is a CONTAINER and navigation sits in its own <button> beside
                      the hint button. A row with `role='button'` around a real button is a control
                      in a control (WCAG 4.1.2) and needs stopPropagation on the "i"; two siblings
                      remove both problems, and the native <button> brings Enter/Space. */}
                  <div className={styles.checklistRow}>
                    <button
                      type='button'
                      className={`${styles.checkNav} press-feedback`}
                      onClick={() => void router.push(item.path)}>
                      <span className={styles.checkBox} />
                      <span className={styles.checkLabel}>{item.label}</span>
                      <span className={styles.checkPoints}>
                        +{item.points}%
                      </span>
                    </button>
                    <button
                      type='button'
                      className={styles.infoBtn}
                      aria-label={t('learnMoreAbout', { label: item.label })}
                      aria-expanded={isExpanded}
                      onClick={() => toggleMetric(item.metricKey)}>
                      <InfoIcon size={16} />
                    </button>
                  </div>
                  <div
                    className={`${styles.hintPanel} ${isExpanded ? styles.hintPanelOpen : ''}`}
                    aria-hidden={!isExpanded}>
                    <p className={styles.hintText}>{item.hint}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContentAtom>
    </CardMolecule>
  );
}
