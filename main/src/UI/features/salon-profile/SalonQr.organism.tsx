import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { DisclosureMolecule } from '../../components/Disclosure/Disclosure.molecule';
import { useMaxScreenBrightness } from '../../shared/hooks/useMaxScreenBrightness';
import { usePermanentCode } from '../shared/profile/usePermanentCode';
import { StylistPermanentCodeOrganism } from '../pairing/StylistPermanentCode.organism';
import styles from './SalonProfileManage.module.css';

// The salon owner uses her existing permanent connection code. The salon
// relationship follows the accepted connection, so there is no second QR identity.
// The code is the last thing on a settings screen, so it is folded and lights
// the screen up only while open (DECISION in useMaxScreenBrightness.ts).
export function SalonQrOrganism() {
  const t = useTranslations('salon.profile');
  const tPairing = useTranslations('pages.pairing');
  const [open, setOpen] = useState(false);
  const code = usePermanentCode();
  useMaxScreenBrightness(open);

  return (
    <DisclosureMolecule title={t('qrTitle')} open={open} onOpenChange={setOpen}>
      <div className={styles.salonQr}>
        <TypographyAtom>{t('qrBody')}</TypographyAtom>
        <StylistPermanentCodeOrganism
          code={code}
          isMainAction={false}
          retryLabel={t('retry')}
          t={tPairing}
        />
      </div>
    </DisclosureMolecule>
  );
}
