// Stylist rows of the CreateSessionModal pick step. Extracted from the
// organism (max-lines 300). Three row kinds:
//   - available  → tap creates a session (per-row „creating" status),
//   - blocked with a known open session → tap opens THAT session,
//   - blocked without one → inert row explaining why it is blocked.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { TypographyAtom } from '../Typography/Typography.atom';
import { AvatarAtom } from '../Avatar/Avatar.atom';
import type { StylistOption } from './CreateSessionModal.types';
import styles from './CreateSessionModal.module.css';

function RowBody({
  stylist,
  children,
}: {
  stylist: StylistOption;
  children?: ReactNode;
}) {
  return (
    <>
      <AvatarAtom
        src={stylist.avatarUrl ?? undefined}
        name={stylist.name}
        size='md'
      />
      <div className={styles.stylistInfo}>
        <TypographyAtom variant='body2'>{stylist.name}</TypographyAtom>
        {children}
      </div>
    </>
  );
}

export function StylistPickRowsMolecule({
  stylists,
  submitting,
  pendingStylistId,
  onPick,
  onOpenSession,
}: {
  stylists: StylistOption[];
  submitting: boolean;
  pendingStylistId: string | null;
  onPick: (stylistId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const t = useTranslations('createSession');
  const available = stylists.filter(s => !s.hasActiveSession);
  const blocked = stylists.filter(s => s.hasActiveSession);

  return (
    <>
      {available.map(s => (
        <button
          key={s.id}
          type='button'
          className={styles.stylistRow}
          disabled={submitting}
          aria-busy={pendingStylistId === s.id}
          onClick={() => onPick(s.id)}>
          <RowBody stylist={s}>
            {s.businessName && (
              <TypographyAtom variant='caption'>
                {s.businessName}
              </TypographyAtom>
            )}
            {pendingStylistId === s.id && (
              <TypographyAtom variant='caption' role='status'>
                {t('creating')}
              </TypographyAtom>
            )}
          </RowBody>
        </button>
      ))}
      {blocked.map(s => {
        const sessionId = s.activeSessionId;
        if (sessionId && onOpenSession) {
          return (
            <button
              key={s.id}
              type='button'
              className={styles.stylistRow}
              disabled={submitting}
              onClick={() => onOpenSession(sessionId)}>
              <RowBody stylist={s}>
                <TypographyAtom
                  variant='caption'
                  className={styles.activeSessionHint}>
                  {t('activeSessionOpenHint')}
                </TypographyAtom>
              </RowBody>
            </button>
          );
        }
        return (
          <div key={s.id} className={styles.stylistRowDisabled}>
            <RowBody stylist={s}>
              <TypographyAtom
                variant='caption'
                className={styles.activeSessionHint}>
                {t('activeSessionHint')}
              </TypographyAtom>
            </RowBody>
          </div>
        );
      })}
    </>
  );
}
