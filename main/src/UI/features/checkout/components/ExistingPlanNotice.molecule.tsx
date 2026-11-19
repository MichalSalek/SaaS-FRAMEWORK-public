import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import styles from '../PlanCheckoutPanel.module.css';

/** A Free selection cannot cancel an existing subscription through checkout. */
export function ExistingPlanNoticeMolecule() {
  const t = useTranslations('account.checkout');
  return (
    <div className={styles.statusViewport} role='status'>
      <p className={styles.statusText}>{t('existingPlan')}</p>
      <LinkButtonAtom href={ROUTES_FRONT.USER_ACCOUNT_PAY}>
        {t('manageExistingPlan')}
      </LinkButtonAtom>
    </div>
  );
}
