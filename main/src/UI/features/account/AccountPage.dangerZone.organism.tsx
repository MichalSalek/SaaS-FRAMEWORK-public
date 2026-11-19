// UI/features/account/AccountPage.dangerZone.organism.tsx
// Section „Strefa krytyczna”: the operations that close or erase the account.

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FireIcon, MoonIcon, TrashIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { KeepTogetherTextAtom } from '../../components/KeepTogetherText/KeepTogetherText.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
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
      onError: () => {
        // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
        // main/src/application/http/queryClient.config.ts). Only the dialog close stays.
        setIsGdprDialogOpen(false);
      },
    });
  };

  const handleDisableConfirm = () => {
    disableSelf(undefined, {
      onError: () => {
        // DECISION: no local error push, same as above: the interceptor shows the concrete backend
        // event (409 CANNOT_DISABLE_ACTIVE_SUBSCRIPTION or GENERAL_ERROR on 500). A local tEvents(...)
        // would duplicate it. Only the dialog close stays.
        setIsDisableDialogOpen(false);
      },
    });
  };

  return (
    <div className={styles.stack}>
      {/* The section label is the screen title (app bar on the phone, page
          heading on desktop); repeating it here stacked the same words twice. */}
      <p className={styles.caption}>{t('sectionCaption')}</p>

      {/* DECISION: the critical zone holds ONLY operations that close or delete something. The
          "Wyloguj się" entry moved to the end of the section list (logging out is not dangerous)
          and the entry to account recovery to the "Dane" section. A row = one sentence of what the operation does +
          one button in the warning tone; no pink background or frame (the icon and the button color
          carry the gravity, not a tinted card). (owner) */}
      <ul className={styles.group}>
        <li className={styles.row}>
          <div className={styles.rowBody}>
            <h2 className={styles.rowTitle}>{t('disableTitle')}</h2>
            <p className={styles.rowText}>
              <KeepTogetherTextAtom>{t('disableBody')}</KeepTogetherTextAtom>
            </p>
          </div>
          <ButtonAtom
            variant='danger'
            size='sm'
            icon={<MoonIcon size={16} />}
            onClick={() => setIsDisableDialogOpen(true)}
            className={`${styles.rowAction} press-feedback`}>
            {t('disableCta')}
          </ButtonAtom>
        </li>
        <li className={styles.row}>
          <div className={styles.rowBody}>
            <h2 className={styles.rowTitle}>{t('deleteTitle')}</h2>
            <p className={styles.rowText}>
              <KeepTogetherTextAtom>{t('deleteBody')}</KeepTogetherTextAtom>
            </p>
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

      {}
      <section className={styles.irreversible} aria-labelledby={gdprLabelId}>
        <p className={styles.groupLabel} id={gdprLabelId}>
          {t('irreversibleLabel')}
        </p>
        <div className={styles.group}>
          <div className={styles.row}>
            <div className={styles.rowBody}>
              <h2 className={styles.rowTitle}>{t('gdprTitle')}</h2>
              <p className={styles.rowText}>
                <KeepTogetherTextAtom>{t('gdprBody')}</KeepTogetherTextAtom>
              </p>
            </div>
            <ButtonAtom
              variant='danger'
              size='sm'
              icon={<FireIcon size={16} />}
              onClick={() => setIsGdprDialogOpen(true)}
              className={`${styles.rowAction} press-feedback`}>
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
              className='press-feedback'>
              {isDisabling
                ? t('disableDialogConfirming')
                : t('disableDialogConfirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>

      {}
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
              className='press-feedback'>
              {isErasing ? t('gdprDialogConfirming') : t('gdprDialogConfirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </div>
  );
}
