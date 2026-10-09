// UI/features/gallery/components/UploadSummaryStep.tsx
// Step 3 of the upload wizard: review card with grouped rows + solid gold
// publish CTA. Extracted from UploadAssetPage.parts to respect the 300 LOC
// ceiling.

import {
  CaretLeftIcon,
  ImageIcon,
  PaletteIcon,
  TagIcon,
  RulerIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import type { ColorDTO, TraitDTO } from '@kernel/models/db_models.manual.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ColorDotAtom } from '../../../components/ColorDot/ColorDot.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import styles from '../UploadAssetPage.module.css';

interface NailLengthOption {
  id: NailLength;
  label: string;
}

interface UploadSummaryStepProps {
  selectedColors: ColorDTO[];
  selectedTraits: TraitDTO[];
  selectedLength: NailLength | null;
  nailLengthOptions: readonly NailLengthOption[];
  onBack: () => void;
  onPublish: () => void;
  /** D1-F6: disable Publish while the upload mutation is in-flight (prevent double-submit). */
  isPublishing?: boolean;
}

export function UploadSummaryStepOrganism({
  selectedColors,
  selectedTraits,
  selectedLength,
  nailLengthOptions,
  onBack,
  onPublish,
  isPublishing = false,
}: UploadSummaryStepProps) {
  const t = useTranslations('pages.gallery');
  const lengthLabel =
    nailLengthOptions.find(l => l.id === selectedLength)?.label ?? '-';
  return (
    /* Listwa akcji jest RODZEŃSTWEM treści kroku, nie jej dzieckiem — powód
       w DECISION przy .stickyActionBar (UploadAssetPage.module.css). */
    <>
      <div
        className={`${styles.stepContent} ${styles.stepContentEnter}`}
        style={{ '--stagger-index': 4 } as React.CSSProperties}>
        <div className={styles.stepHeader}>
          <TypographyAtom variant='h3' className={styles.stepHeaderTitle}>
            {t('uploadReadyTitle')}
          </TypographyAtom>
          <TypographyAtom variant='body2' className={styles.stepHeaderSubtitle}>
            {t('uploadReadySubtitle')}
          </TypographyAtom>
        </div>

        {/* DECISION (nie usuwaj tego komentarza) — pomiar 2026-09-09:
            Trzy wiersze podsumowania = JEDEN system wartości. Wcześniej ta sama
            lista mówiła trzema językami: kolor jako kropka z tekstem 14px, cecha
            jako obramowany chip (czyli kontrolka, choć nic tu nie klikalne),
            długość jako duży bold 16px bez ramki. Teraz każdy wiersz to
            `.summaryValues` z pozycjami `.summaryValueItem` w jednej typografii,
            a kolor dokłada wyłącznie kropkę — jedyną informację, której nie
            da się zapisać słowem. */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryRow}>
            <div className={styles.summaryRowHeader}>
              <PaletteIcon
                size={14}
                weight='fill'
                className={styles.summaryRowIcon}
              />
              <TypographyAtom variant='caption' className={styles.summaryLabel}>
                {t('uploadSummaryColors')}
              </TypographyAtom>
            </div>
            <div className={styles.summaryValues}>
              {selectedColors.map(c => (
                <span key={c.id} className={styles.summaryValueItem}>
                  <ColorDotAtom color={c.hex_code} size='sm' />
                  {c.name}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.summaryRow}>
            <div className={styles.summaryRowHeader}>
              <TagIcon
                size={14}
                weight='fill'
                className={styles.summaryRowIcon}
              />
              <TypographyAtom variant='caption' className={styles.summaryLabel}>
                {t('uploadSummaryTraits')}
              </TypographyAtom>
            </div>
            <div className={styles.summaryValues}>
              {selectedTraits.map(tr => (
                <span key={tr.id} className={styles.summaryValueItem}>
                  {tr.name}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.summaryRow}>
            <div className={styles.summaryRowHeader}>
              <RulerIcon
                size={14}
                weight='fill'
                className={styles.summaryRowIcon}
              />
              <TypographyAtom variant='caption' className={styles.summaryLabel}>
                {t('uploadSummaryLength')}
              </TypographyAtom>
            </div>
            <div className={styles.summaryValues}>
              <span className={styles.summaryValueItem}>{lengthLabel}</span>
            </div>
          </div>
        </div>

        {/* Pre-publish privacy reminder. Policy SSOT: docs/DOMAIN/product/CONTENT_MODERATION_POLICY.md §2.2/§5. */}
        <div className={styles.policyNote}>
          <ShieldCheckIcon
            size={18}
            weight='fill'
            className={styles.policyNoteIcon}
            aria-hidden='true'
          />
          <TypographyAtom variant='caption' className={styles.policyNoteText}>
            {t('uploadPolicyNote')}
          </TypographyAtom>
        </div>
      </div>

      <div className={styles.stickyActionBar}>
        <ButtonAtom
          variant='outlined'
          size='md'
          icon={<CaretLeftIcon size={16} />}
          onClick={onBack}>
          {t('uploadBack')}
        </ButtonAtom>
        <ButtonAtom
          variant='primary'
          size='md'
          icon={<ImageIcon size={18} weight='fill' />}
          onClick={onPublish}
          disabled={isPublishing}
          className={`${styles.stickyPrimaryCta} ${styles.publishCta} haptic-press`}>
          {t('uploadPublish')}
        </ButtonAtom>
      </div>
    </>
  );
}
