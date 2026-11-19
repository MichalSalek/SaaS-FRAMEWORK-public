import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import type { PairingAudience } from '../shared/pairing/pairingAudience';
import styles from './StylistProfilePage.module.css';

function ValueCheck() {
  return (
    <span className={styles.lineIcon} aria-hidden='true'>
      <CheckCircleIcon size={18} />
    </span>
  );
}

export function StylistPairingExplainerMolecule({
  audience,
  action,
}: {
  audience: PairingAudience;
  action: ReactNode;
}) {
  const t = useTranslations('stylist.pairingExplainer');
  let heading: string;
  let description: string;
  let showBenefits = false;
  switch (audience) {
    case 'checking':
    case 'accessFailed':
    case 'clientPaired':
      return <>{action}</>;
    case 'guest':
      heading = t('howTitle');
      description = t('howGuest');
      showBenefits = true;
      break;
    case 'clientOnboarding':
      heading = t('howTitle');
      description = t('howClientOnboarding');
      showBenefits = true;
      break;
    case 'clientPublic':
      heading = t('howTitle');
      description = t('howItWorks');
      showBenefits = true;
      break;
    case 'clientPending':
      heading = t('howTitle');
      description = t('howPending');
      showBenefits = true;
      break;
    case 'owner':
      heading = t('howOwnTitle');
      description = t('howOwnProfile');
      break;
    case 'stylistWithClient':
      heading = t('howTitle');
      description = t('howOtherStylistWithClient');
      break;
    case 'stylistNoClient':
      heading = t('howTitle');
      description = t('howOtherStylistNoClient');
      break;
    default: {
      const exhaustive: never = audience;
      return exhaustive;
    }
  }

  return (
    <section className={styles.pairingExplainer}>
      <TypographyAtom variant='h2' className={styles.pairingExplainerTitle}>
        {heading}
      </TypographyAtom>
      <div className={styles.pairingInstructions}>
        {audience === 'owner' && (
          <TypographyAtom variant='body2'>{t('ownerOnly')}</TypographyAtom>
        )}
        <TypographyAtom variant='body1'>{description}</TypographyAtom>
        {action}
      </div>
      {/* DECISION: (owner) Updated 2026-11-05: the former sharedNote followed a blind A/B result,
          but the owner replaced it with concise connection instructions. Privacy details
          remain in the privacy policy; do not restore a disclosure paragraph here. */}
      {showBenefits && (
        <>
          <TypographyAtom variant='h2' className={styles.pairingExplainerTitle}>
            {t('title')}
          </TypographyAtom>
          <ul className={styles.valueList}>
            <li>
              <ValueCheck />
              <span>{t('afterItems.fullGallery')}</span>
            </li>
            <li>
              <ValueCheck />
              <span>{t('afterItems.sessions')}</span>
            </li>
            <li>
              <ValueCheck />
              <span>{t('afterItems.history')}</span>
            </li>
            <li>
              <ValueCheck />
              <span>{t('afterItems.messages')}</span>
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
