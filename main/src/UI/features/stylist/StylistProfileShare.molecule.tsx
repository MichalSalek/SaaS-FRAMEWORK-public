import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShareButtonAtom } from '../../components/ShareButton/ShareButton.atom';
import styles from './StylistProfilePage.module.css';

export function StylistProfileShareMolecule({
  account,
}: {
  account: {
    account_id: string;
    display_name: string | null;
    business_name: string | null;
  };
}) {
  const t = useTranslations('stylist.actions');
  const fallback = useTranslations('labels')('stylistFallback');
  // Do not forward QR attribution, and recompute on profile-to-profile navigation.
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl(`${window.location.origin}${window.location.pathname}`);
  }, [account.account_id]);
  return (
    <section className={styles.section}>
      <ShareButtonAtom
        url={url}
        title={account.display_name || account.business_name || fallback}
        text={t('shareText')}
        className={styles.shareAction}
      />
    </section>
  );
}
