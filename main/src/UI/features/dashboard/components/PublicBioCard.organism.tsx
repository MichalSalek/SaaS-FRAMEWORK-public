// UI/features/dashboard/components/PublicBioCard.organism.tsx
// „O mnie” on the stylist dashboard: the PUBLIC text of her profile
// (`description`), edited where she already looked for it.
//
// DECISION: this card replaced the private „Notatki” field (owner). Right under the
// share card, a stylist read that field as the text for her clients and wrote a self-introduction
// into it. The place now holds exactly that public text, saved by an explicit button, and the
// private notes moved to their own screen (/app/notes, drawer „Notatki”). Do not put a private
// field back here.

import { useTranslations } from 'next-intl';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { PublicBioEditorOrganism } from '../../shared/profile/PublicBioEditor.organism';
import pageStyles from '../DashboardPage.module.css';
import styles from './PublicBioCard.module.css';

export function PublicBioCardOrganism() {
  const t = useTranslations('components.publicBio');
  const { data: user } = useCurrentUserAccount();
  const stylistAccount = user?.stylist_account ?? null;

  return (
    <section
      className={pageStyles.section}
      data-app-section='plain'
      aria-labelledby='public-bio-title'>
      <div className={styles.head}>
        <h2
          id='public-bio-title'
          className={pageStyles.sectionTitle}
          data-app-section-title=''>
          {t('title')}
        </h2>
        <p className={pageStyles.quietLine}>{t('visibility')}</p>
      </div>
      {stylistAccount ? (
        // Keyed by account: become-user or a role switch starts a fresh draft.
        <PublicBioEditorOrganism
          key={stylistAccount.account_id}
          stylistAccount={stylistAccount}
          hint={null}
          // The share card right above already has „Zobacz profil”.
          showProfileLink={false}
        />
      ) : (
        <SkeletonAtom variant='rect' width='100%' height={120} />
      )}
    </section>
  );
}
