// UI/features/support/SupportNewThreadPage.composition.tsx
// Route SUPPORT_NEW: its own screen for a new request, reachable straight from
// the navigation („Zgłoś błąd lub pomysł”) and from the help hub.

import { useTranslations } from 'next-intl';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { SupportNewThreadFormOrganism } from './SupportNewThreadForm.organism';
import styles from './SupportNewThreadPage.module.css';

function SupportNewThreadPageInner() {
  const t = useTranslations('pages.support');
  useAppBarTitle(t('newThreadTitle'));

  return (
    <div className={styles.page}>
      <AppHeroOrganism
        title={t('newThreadTitle')}
        subtitle={t('newThreadIntro')}
      />
      <SupportNewThreadFormOrganism />
    </div>
  );
}

export function SupportNewThreadPageComposition() {
  const t = useTranslations('pages.support');
  return (
    <AppLayoutComposition title={t('newThreadTitle')}>
      <SupportNewThreadPageInner />
    </AppLayoutComposition>
  );
}
