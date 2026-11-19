// „Co wybierają klientki”: the tags of inspiration photos shared in this
// stylist's sessions. The backend decides plan access; the Free Demo still sees
// how much material she already has and a quiet route to the paid plans.

import { useLocale, useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { getLocalizedTaxonomyName } from '../../../../domain/gallery/gallery-taxonomy.locale';
import { useSessionInsights } from '../hooks/useSessionInsights';
import pageStyles from '../DashboardPage.module.css';
import styles from './SessionInsightsCard.module.css';

const LENGTH_LABEL = {
  SHORT: 'lengths.short',
  MEDIUM: 'lengths.medium',
  LONG: 'lengths.long',
  XL: 'lengths.xl',
} as const;

export function SessionInsightsCardOrganism() {
  const t = useTranslations('dashboard.stylist.insights');
  const locale = useLocale();
  const query = useSessionInsights();

  // A brand-new stylist has nothing to analyse: the card appears with the
  // first shared inspiration instead of flashing an empty skeleton.
  if (query.isLoading && query.data === undefined) {
    return null;
  }

  if (query.isError || !query.data) {
    return (
      <section className={pageStyles.section} data-app-section='plain'>
        <h2 className={pageStyles.sectionTitle} data-app-section-title=''>
          {t('title')}
        </h2>
        <p className={pageStyles.quietLine}>{t('loadError')}</p>
        <ButtonAtom
          variant='text'
          size='sm'
          onClick={() => void query.refetch()}>
          {t('retry')}
        </ButtonAtom>
      </section>
    );
  }

  const data = query.data;
  if (data.sessions_count === 0) {
    return null;
  }
  const hasTags =
    data.top_colors.length > 0 ||
    data.top_traits.length > 0 ||
    data.top_lengths.length > 0;

  return (
    <section
      className={`${styles.card} micro-enter`}
      data-app-section='bordered'>
      <div className={styles.head}>
        <h2 className={pageStyles.sectionTitle} data-app-section-title=''>
          {t('title')}
        </h2>
        <p className={pageStyles.quietLine}>
          {t('summary', {
            sessions: data.sessions_count,
            photos: data.photos_count,
          })}
        </p>
      </div>

      {!data.available && (
        <div className={styles.locked}>
          <p className={styles.lockedTitle}>{t('lockedTitle')}</p>
          <p className={styles.body}>
            {t('lockedBody', {
              sessions: data.sessions_count,
              photos: data.photos_count,
            })}
          </p>
          <LinkButtonAtom
            href={ROUTES_FRONT.USER_ACCOUNT_PAY}
            variant='outlined'
            size='sm'>
            {t('lockedCta')}
          </LinkButtonAtom>
        </div>
      )}

      {data.available && !hasTags && (
        <p className={styles.body}>{t('empty')}</p>
      )}

      {data.available && hasTags && (
        <div className={styles.groups}>
          {data.top_colors.length > 0 && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>{t('colors')}</span>
              <ul className={styles.tags}>
                {data.top_colors.map(color => (
                  <li key={color.name} className={styles.tag}>
                    <span
                      className={styles.swatch}
                      style={{ background: color.hex_code }}
                      aria-hidden='true'
                    />
                    <span>{getLocalizedTaxonomyName(color.name, locale)}</span>
                    <span className={styles.count}>{color.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.top_traits.length > 0 && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>{t('traits')}</span>
              <ul className={styles.tags}>
                {data.top_traits.map(trait => (
                  <li key={trait.name} className={styles.tag}>
                    <span>{getLocalizedTaxonomyName(trait.name, locale)}</span>
                    <span className={styles.count}>{trait.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.top_lengths.length > 0 && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>{t('lengthsTitle')}</span>
              <ul className={styles.tags}>
                {data.top_lengths.map(length => (
                  <li key={length.length} className={styles.tag}>
                    <span>{t(LENGTH_LABEL[length.length])}</span>
                    <span className={styles.count}>{length.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
