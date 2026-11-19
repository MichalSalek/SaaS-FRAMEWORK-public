// UI/features/account/components/SessionRow.molecule.tsx
// One signed-in device of the „Bezpieczeństwo” list: what it is (browser and
// system, else the sign-in date), when it signed in, and ONE trailing control
// (the „this device” mark, or the button that signs that device out).

import {
  DeviceMobileIcon,
  DeviceTabletIcon,
  MonitorIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import { formatDateTime } from '../../../../application/date/date.utils';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { describeSessionDevice } from '../helpers/session-user-agent.helper';
import styles from './SessionsTab.module.css';

type SafeSession =
  SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE']['sessions'][number];

function DeviceIcon({ deviceType }: { deviceType: string | null }) {
  const type = deviceType?.toLowerCase() ?? '';
  if (type.includes('tablet')) {
    return <DeviceTabletIcon size={22} />;
  }
  if (type.includes('mobile') || type.includes('phone')) {
    return <DeviceMobileIcon size={22} />;
  }
  return <MonitorIcon size={22} />;
}

interface SessionRowProps {
  session: SafeSession;
  isDeleting: boolean;
  actionsLocked: boolean;
  onLogout: (id: string) => void;
}

export function SessionRowMolecule({
  session,
  isDeleting,
  actionsLocked,
  onLogout,
}: SessionRowProps) {
  const t = useTranslations('account.sessions');
  const lang = useCurrentLang();
  const signedInAt = formatDateTime(session.createdAt, lang);
  const device = describeSessionDevice(session.user_agent);
  // The date is stated once per row: as the name when nothing better is
  // known, otherwise in the quiet line under the name.
  const name = device ?? t('sessionFallbackName', { date: signedInAt });
  // The sign-in date is one unbreakable piece; an address may be longer than
  // the line (IPv6), so it is allowed to break instead of being cut.
  const metaParts: { text: string; breakable: boolean }[] = [];
  if (device !== null) {
    metaParts.push({
      text: t('signedInAt', { date: signedInAt }),
      breakable: false,
    });
  }
  if (session.ip_address) {
    metaParts.push({
      text: t('ipLabel', { ip: session.ip_address }),
      breakable: true,
    });
  }

  return (
    <li className={styles.row} data-lines={metaParts.length > 0 ? 2 : 1}>
      <span className={styles.rowIcon} aria-hidden='true'>
        <DeviceIcon deviceType={session.device_type} />
      </span>
      <span className={styles.rowBody}>
        <span className={styles.rowName}>{name}</span>
        {metaParts.length > 0 && (
          <span className={styles.rowMeta}>
            {metaParts.map((part, index) => (
              <span
                key={part.text}
                className={styles.rowMetaPart}
                {...(part.breakable ? { 'data-breakable': '' } : {})}>
                {index < metaParts.length - 1 ? `${part.text},` : part.text}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className={styles.rowAction}>
        {session.is_current ? (
          <StatusPillAtom
            color='var(--color-success)'
            label={t('currentSessionChip')}
          />
        ) : (
          <ButtonAtom
            variant='outlined'
            size='sm'
            disabled={actionsLocked}
            loading={isDeleting}
            ariaLabel={t('logoutOneAria', { device: name })}
            onClick={() => onLogout(session.id)}>
            {t('logoutOneBtn')}
          </ButtonAtom>
        )}
      </span>
    </li>
  );
}
