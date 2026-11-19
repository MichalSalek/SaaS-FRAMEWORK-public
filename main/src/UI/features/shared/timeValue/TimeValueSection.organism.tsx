import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { SectionComposition } from '../../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../../components/SectionHeader/SectionHeader.molecule';
import {
  EntryPriceNoteMolecule,
  selectEntryPrice,
} from '../pricing/EntryPriceNote.molecule';
import { usePricingPlans } from '../pricing/hooks/usePricingPlans';
import { calculateTimeValue, DEFAULT_TIME_ASSUMPTIONS } from './time-value';
import styles from './TimeValueSection.module.css';

interface TimeValueSectionProps {
  /** Unique per instance, used for the section heading and both fields. */
  id: string;
}

export function TimeValueSectionOrganism({ id }: TimeValueSectionProps) {
  const t = useTranslations('components.timeValue');
  const locale = useLocale();
  const [minutes, setMinutes] = useState<string>(
    DEFAULT_TIME_ASSUMPTIONS.minutes
  );
  const [clients, setClients] = useState<string>(
    DEFAULT_TIME_ASSUMPTIONS.clients
  );
  const result = calculateTimeValue(minutes, clients);
  const { data, isPending, isError, pricesUnavailable } = usePricingPlans();
  const hasPaidPrice =
    !isPending &&
    !isError &&
    !pricesUnavailable &&
    data !== undefined &&
    selectEntryPrice(data) !== null;
  const duration =
    result && result.hours > 0
      ? result.remainingMinutes === 0
        ? new Intl.NumberFormat(locale, {
            style: 'unit',
            unit: 'hour',
            unitDisplay: 'short',
          }).format(result.hours)
        : t('hoursMinutes', {
            hours: result.hours,
            minutes: result.remainingMinutes,
          })
      : null;

  return (
    <SectionComposition
      id={id}
      fullBleed={false}
      aria-labelledby={`${id}-heading`}>
      <div className={styles.layout}>
        <div className={styles.intro}>
          <SectionHeaderMolecule
            titleId={`${id}-heading`}
            title={t('headline')}>
            {t('body')}
          </SectionHeaderMolecule>
          <p className={styles.useTime}>{t('betaEvidence')}</p>
          <p className={styles.useTime}>{t('useTime')}</p>
        </div>
        <div className={styles.calculator}>
          <p className={styles.example}>{t('exampleLabel')}</p>
          <div className={styles.fields}>
            <InputAtom
              id={`${id}-minutes`}
              label={t('minutesLabel')}
              suffix={t('minutesUnit')}
              type='number'
              inputMode='numeric'
              min={0}
              step={1}
              value={minutes}
              onChange={event => setMinutes(event.currentTarget.value)}
            />
            <InputAtom
              id={`${id}-clients`}
              label={t('visitsLabel')}
              type='number'
              inputMode='numeric'
              min={0}
              step={1}
              value={clients}
              onChange={event => setClients(event.currentTarget.value)}
            />
          </div>
          <div className={styles.result} aria-live='polite' aria-atomic='true'>
            {result === null ? (
              <p>{t('incomplete')}</p>
            ) : (
              <>
                <p className={styles.total}>
                  {t('totalMinutes', { minutes: result.totalMinutes })}
                </p>
                <p className={styles.totalLabel}>{t('totalLabel')}</p>
                {duration && <p className={styles.duration}>{duration}</p>}
              </>
            )}
          </div>
        </div>
        <div className={styles.roi}>
          <h3>{t('roiTitle')}</h3>
          <p>{t('roiBody')}</p>
          {hasPaidPrice && <EntryPriceNoteMolecule />}
          <LinkButtonAtom href={ROUTES_FRONT.PRICING} variant='outlined'>
            {t('pricingCta')}
          </LinkButtonAtom>
        </div>
      </div>
    </SectionComposition>
  );
}
