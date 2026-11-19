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
import type { QuotaSnapshot } from '../../../../application/pricing/quota.helpers';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ColorDotAtom } from '../../../components/ColorDot/ColorDot.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { QuotaNoticeMolecule } from '../../shared/upsell/QuotaNotice.molecule';
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
  quota: QuotaSnapshot;
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
  quota,
  isPublishing = false,
}: UploadSummaryStepProps) {
  const t = useTranslations('pages.gallery');
  const lengthLabel =
    nailLengthOptions.find(l => l.id === selectedLength)?.label ?? '-';
  return (
    /* The action bar is a SIBLING of the step content, not its child; see the
       DECISION at .stickyActionBar (UploadAssetPage.module.css). */
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

        {/* DECISION: the three summary rows are ONE value system. The same list used to speak
            three languages: colour as a dot with 14px text, a trait as a bordered chip (a
            control, though nothing here is clickable), length as large bold 16px without a
            frame. Now every row is `.summaryValues` with `.summaryValueItem` items in one
            typography, and colour adds only the dot, the one piece of information that cannot
            be written as a word. */}
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

        {}
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
        {quota.state === 'one_remaining' && (
          <QuotaNoticeMolecule
            feature='gallery'
            quota={quota}
            className={styles.stickyActionBarReason}
          />
        )}
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
          className={`${styles.stickyPrimaryCta} ${styles.publishCta} press-feedback`}>
          {t('uploadPublish')}
        </ButtonAtom>
      </div>
    </>
  );
}
