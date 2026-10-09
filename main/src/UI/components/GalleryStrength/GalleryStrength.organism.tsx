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
  hasProfileBio: boolean;
  hasProfilePhoto: boolean;
  hasSpecialization: boolean;
  pairedClientCount: number;
  /**
   * Zamknięcie karty. Krzyżyk pojawia się WYŁĄCZNIE przy 100% — wcześniej
   * karta niesie zadanie do zrobienia i nie ma czego zamykać (owner
   * 2026-09-17). Brak handlera = karty nie da się zamknąć (biblioteka
   * komponentów, podgląd).
   */
  onDismiss?: () => void;
  /**
   * Znacznik z bazy: stylistka już tę kartę zamknęła.
   *
   * DECISION (nie usuwaj tego komentarza): o schowaniu decyduje KOMPONENT, nie
   * pulpit, bo to on liczy wynik. Pulpit ma tylko wynik z backendu, liczony
   * INNYM wzorem (tam maksimum bywa 85-90 przy tym samym, kompletnym profilu),
   * więc warunek „zamknięte ORAZ 100%" postawiony na zewnątrz nigdy się nie
   * spełniał i karta wracała po przeładowaniu mimo zapisu w bazie. Jeden wynik,
   * jedno miejsce decyzji.
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

// DECISION (nie usuwaj tego komentarza):
// JEDNA tabela wag zasila i wynik, i „+X%" przy pozycjach checklisty. Wcześniej
// były to dwa niezależne zestawy liczb i rozjechały się na obie strony:
//  1. Maksimum osiągalne wynosiło 90, nie 100 — więc gałąź `hintComplete`
//     („Twoja galeria jest kompletna") była MARTWA we wszystkich trzech
//     językach, a stylistka z uzupełnionym profilem widziała pustą checklistę
//     razem z komunikatem „Uzupełnij profil". `Math.min(score, 100)` nigdy nie
//     miał czego przyciąć.
//  2. Ukryty bonus (+10 za „10 zdjęć ORAZ klientka") nie miał pozycji na
//     liście, więc obiecane „+15%" za pierwszą klientkę dawało w rzeczywistości
//     +25%. Bonus został wchłonięty w jawne progi — każda pozycja checklisty
//     dodaje teraz DOKŁADNIE tyle, ile deklaruje.
// Suma wszystkich wag = 100 i pilnuje tego `GalleryStrength.score.test.ts`.
// Zmieniając którąkolwiek wagę, wyrównaj pozostałe — inaczej test padnie.
// Progi zdjęć celowo ujawniają się po kolei (checklista prowadzi do następnego
// progu, nie pokazuje wszystkich trzech naraz), więc suma widocznych pozycji
// równa się brakującym punktom dopiero od 10 zdjęć w górę.
const STRENGTH_WEIGHTS = {
  /** Endowed progress — użytkowniczka NIGDY nie startuje od zera. */
  BASE: 25,
  PHOTO_1: 5,
  PHOTO_5: 10,
  PHOTO_10: 15,
  BIO: 10,
  PROFILE_PHOTO: 10,
  SPECIALIZATION: 10,
  PAIRED_CLIENT: 15,
} as const;

export function calculateStrength(props: GalleryStrengthProps): number {
  let score: number = STRENGTH_WEIGHTS.BASE;
  if (props.photoCount >= 1) {
    score += STRENGTH_WEIGHTS.PHOTO_1;
  }
  if (props.photoCount >= 5) {
    score += STRENGTH_WEIGHTS.PHOTO_5;
  }
  if (props.photoCount >= 10) {
    score += STRENGTH_WEIGHTS.PHOTO_10;
  }
  if (props.hasProfileBio) {
    score += STRENGTH_WEIGHTS.BIO;
  }
  if (props.hasProfilePhoto) {
    score += STRENGTH_WEIGHTS.PROFILE_PHOTO;
  }
  if (props.hasSpecialization) {
    score += STRENGTH_WEIGHTS.SPECIALIZATION;
  }
  if (props.pairedClientCount >= 1) {
    score += STRENGTH_WEIGHTS.PAIRED_CLIENT;
  }
  return score;
}

/** Suma wag = maksimum osiągalne; test pilnuje, że wynosi 100. */
export const MAX_STRENGTH_SCORE = Object.values(STRENGTH_WEIGHTS).reduce(
  (sum, weight) => sum + weight,
  0
);

type TFn = ReturnType<typeof useTranslations<'galleryStrength'>>;

function getMissingItems(props: GalleryStrengthProps, t: TFn): MissingItem[] {
  const items: MissingItem[] = [];

  if (props.photoCount < 10) {
    if (props.photoCount < 1) {
      items.push({
        label: t('addFirstPhoto'),
        points: STRENGTH_WEIGHTS.PHOTO_1,
        path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
        metricKey: 'photos',
        hint: t('addPhotosHint'),
      });
    } else if (props.photoCount < 5) {
      items.push({
        label: t('addMorePhotos5'),
        points: STRENGTH_WEIGHTS.PHOTO_5,
        path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
        metricKey: 'photos',
        hint: t('addPhotosHint'),
      });
    } else {
      items.push({
        label: t('addMorePhotos10'),
        points: STRENGTH_WEIGHTS.PHOTO_10,
        path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
        metricKey: 'photos',
        hint: t('addPhotosHint'),
      });
    }
  }
  if (!props.hasProfileBio) {
    items.push({
      label: t('completeBio'),
      points: STRENGTH_WEIGHTS.BIO,
      path: ROUTES_FRONT.USER_ACCOUNT,
      metricKey: 'bio',
      hint: t('completeBioHint'),
    });
  }
  if (!props.hasProfilePhoto) {
    items.push({
      label: t('addProfilePhoto'),
      points: STRENGTH_WEIGHTS.PROFILE_PHOTO,
      path: ROUTES_FRONT.USER_ACCOUNT,
      metricKey: 'profilePhoto',
      hint: t('completeBioHint'),
    });
  }
  if (!props.hasSpecialization) {
    items.push({
      label: t('addSpecialization'),
      points: STRENGTH_WEIGHTS.SPECIALIZATION,
      path: ROUTES_FRONT.USER_ACCOUNT,
      metricKey: 'specialization',
      hint: t('addSpecializationHint'),
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

  // Zamknięta karta wraca, gdy wynik spadnie poniżej 100% — wtedy znowu niesie
  // zadanie do zrobienia (owner 2026-09-17).
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
              {/* Liczba DANYCH: Marcellus (display serif) renderuje "0" jak
                  literę "O" — licznik jedzie w sans + tabular-nums przez
                  globalną utility .data-count (S26 census). */}
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
              className={`${styles.dismiss} haptic-press`}
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
                  {/* DECISION (nie usuwaj tego komentarza):
                      Wiersz jest KONTENEREM, a nawigacja siedzi we własnym
                      <button> obok przycisku podpowiedzi — nie odwrotnie.
                      Wcześniej cały wiersz był `role='button' tabIndex={0}`
                      i zawierał w środku drugi, prawdziwy przycisk: kontrolka
                      w kontrolce, której technologia asystująca nie umie
                      opisać (WCAG 4.1.2), a klikanie ikony „i" wymagało
                      stopPropagation, żeby nie odpalić nawigacji.
                      Dwa rodzeństwa zamiast zagnieżdżenia usuwają jedno i drugie.
                      Ręczna obsługa Enter/Spacji zniknęła razem z div-em —
                      natywny <button> ma ją z definicji. */}
                  <div className={styles.checklistRow}>
                    <button
                      type='button'
                      className={`${styles.checkNav} haptic-press`}
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
