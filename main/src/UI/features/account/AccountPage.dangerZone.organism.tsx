// UI/features/account/AccountPage.dangerZone.organism.tsx
// Section „Strefa krytyczna”: the operations that close or erase the account.

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FireIcon, MoonIcon, TrashIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useDisableUserSelf } from './hooks/useDisableUserSelf';
import { useGdprErase } from './hooks/useGdprErase';
import styles from './AccountDangerZone.module.css';

/* ─── Danger zone panel ─── */

export function DangerZonePanelOrganism() {
  const t = useTranslations('account.dangerZone');
  const gdprLabelId = useId();

  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false);
  const { mutate: disableSelf, isPending: isDisabling } = useDisableUserSelf();

  const [isGdprDialogOpen, setIsGdprDialogOpen] = useState(false);
  const { mutate: gdprErase, isPending: isErasing } = useGdprErase();

  const handleGdprConfirm = () => {
    gdprErase(undefined, {
      onSuccess: () => {
        // Hook signs the user out + redirects HOME (record no longer exists).
        pushNewSnackbar(APP_EVENTS.INFO.USER.ACCOUNT_GDPR_ERASED, 'success');
      },
      onError: () => {
        // DECISION (nie usuwaj tego komentarza):
        // Błąd toastuje HTTP interceptor (event-bus Stage 1) — pure-transport
        // mutacja bez silentBusinessError, więc każda porażka HTTP jest już
        // pokazana (backend event / INTERNET_CONNECTION_PROBLEM). Lokalny push
        // GENERAL_ERROR duplikowałby ją (inny event key nigdy nie dedupuje).
        // Zostaje tylko zamknięcie dialogu.
        setIsGdprDialogOpen(false);
      },
    });
  };

  const handleDisableConfirm = () => {
    disableSelf(undefined, {
      onError: () => {
        // DECISION (nie usuwaj tego komentarza):
        // Błąd toastuje HTTP interceptor (event-bus Stage 1) — na porażce HTTP
        // pokazuje konkretny backendowy event z wiadomością events.json: 409
        // CANNOT_DISABLE_ACTIVE_SUBSCRIPTION (aktywna subskrypcja) lub
        // GENERAL_ERROR (500). Lokalny push tEvents(...) duplikowałby to
        // (przetłumaczony string nigdy nie dedupuje z event-key interceptora).
        // Zostaje tylko zamknięcie dialogu.
        setIsDisableDialogOpen(false);
      },
    });
  };

  return (
    <div className={styles.stack}>
      {/* The section label is the screen title (app bar on the phone, page
          heading on desktop); repeating it here stacked the same words twice. */}
      <p className={styles.caption}>{t('sectionCaption')}</p>

      {/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
          strefa krytyczna trzyma WYŁĄCZNIE operacje, które coś zamykają albo
          kasują. „Wyloguj się” przeszło na koniec listy sekcji (wylogowanie
          nie jest groźne), a wejście do przywracania konta do sekcji „Dane”.
          Wiersz = co robi operacja w jednym zdaniu + jeden przycisk w tonie
          ostrzegawczym; bez różowego tła i różowej ramy (grozę niesie ikona
          i kolor przycisku, nie zabarwiona karta). */}
      <ul className={styles.group}>
        <li className={styles.row}>
          <div className={styles.rowBody}>
            <h2 className={styles.rowTitle}>{t('disableTitle')}</h2>
            <p className={styles.rowText}>{t('disableBody')}</p>
          </div>
          <ButtonAtom
            variant='danger'
            size='sm'
            icon={<MoonIcon size={16} />}
            onClick={() => setIsDisableDialogOpen(true)}
            className={`${styles.rowAction} haptic-press`}>
            {t('disableCta')}
          </ButtonAtom>
        </li>
        <li className={styles.row}>
          <div className={styles.rowBody}>
            <h2 className={styles.rowTitle}>{t('deleteTitle')}</h2>
            <p className={styles.rowText}>{t('deleteBody')}</p>
          </div>
          <LinkButtonAtom
            href={ROUTES_FRONT.USER_DEL_SELF}
            variant='danger'
            size='sm'
            icon={<TrashIcon size={16} />}
            className={styles.rowAction}>
            {t('deleteCta')}
          </LinkButtonAtom>
        </li>
      </ul>

      {/* GDPR permanent erasure — Art. 17, irreversible hard-delete.
       * DECISION (nie usuwaj tego komentarza):
       * Distinct from the soft-delete above (which keeps a recoverable record for
       * 90 days). This is the ONLY path to actual data erasure (§13.1) — no
       * recovery, no 90-day window. Visually last and in its own box, under its
       * own label, behind its own confirm dialog. */}
      <section className={styles.irreversible} aria-labelledby={gdprLabelId}>
        <p className={styles.groupLabel} id={gdprLabelId}>
          {t('irreversibleLabel')}
        </p>
        <div className={styles.group}>
          <div className={styles.row}>
            <div className={styles.rowBody}>
              <h2 className={styles.rowTitle}>{t('gdprTitle')}</h2>
              <p className={styles.rowText}>{t('gdprBody')}</p>
            </div>
            <ButtonAtom
              variant='danger'
              size='sm'
              icon={<FireIcon size={16} />}
              onClick={() => setIsGdprDialogOpen(true)}
              className={`${styles.rowAction} haptic-press`}>
              {t('gdprCta')}
            </ButtonAtom>
          </div>
        </div>
      </section>

      {/* Disable confirmation dialog */}
      <AppDialogAtom
        open={isDisableDialogOpen}
        onOpenChange={open => {
          if (!isDisabling && !open) {
            setIsDisableDialogOpen(false);
          }
        }}
        disablePointerDismissal={isDisabling}>
        <AppDialogAtom.Content
          title={t('disableDialogTitle')}
          description={t('disableDialogBody')}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='ghost'
              size='lg'
              onClick={() => setIsDisableDialogOpen(false)}
              disabled={isDisabling}>
              {t('disableDialogCancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='danger'
              size='lg'
              icon={<MoonIcon size={16} />}
              onClick={handleDisableConfirm}
              disabled={isDisabling}
              className='haptic-press'>
              {isDisabling
                ? t('disableDialogConfirming')
                : t('disableDialogConfirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>

      {/* GDPR permanent-erasure confirmation dialog (destructive, irreversible) */}
      <AppDialogAtom
        open={isGdprDialogOpen}
        onOpenChange={open => {
          if (!isErasing && !open) {
            setIsGdprDialogOpen(false);
          }
        }}
        disablePointerDismissal={isErasing}>
        <AppDialogAtom.Content
          title={t('gdprDialogTitle')}
          description={t('gdprDialogBody')}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='ghost'
              size='lg'
              onClick={() => setIsGdprDialogOpen(false)}
              disabled={isErasing}>
              {t('gdprDialogCancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='danger'
              size='lg'
              icon={<FireIcon size={16} weight='fill' />}
              onClick={handleGdprConfirm}
              disabled={isErasing}
              className='haptic-press'>
              {isErasing ? t('gdprDialogConfirming') : t('gdprDialogConfirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </div>
  );
}
