import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';

import { useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import {
  useExportUserData,
  type ExportResult,
} from '../hooks/useExportUserData';
import styles from './DataExportSection.module.css';

/* ─── Component ─── */

export function DataExportSectionOrganism() {
  const t = useTranslations('account.dataExport');
  const { mutate, isPending } = useExportUserData();
  // DECISION: the export result STAYS on screen, on the line under the button. Only a toast used to
  // tell about it, which vanished after seconds and the screen returned to its pre-click state. The
  // line is always mounted (at rest it carries the file description), so nothing shifts when a
  // result appears. There is no success toast any more: the same fact told twice.
  const [result, setResult] = useState<ExportResult | null>(null);

  const handleExport = () => {
    if (isPending) {
      return;
    }
    setResult(null);
    mutate(
      {},
      {
        // Wynik mówi PRAWDĘ o miejscu docelowym (owner — generyczne
        // „wyeksportowano" nie mówiło GDZIE): web = nazwa pobranego pliku,
        // native (WebView bez DownloadListenera) = schowek.
        onSuccess: setResult,
        // DECISION: an HTTP error of the export (exportUserData_IO) is toasted by the interceptor
        // (event-bus Stage 1: USER_DATA_EXPORT_RATE_LIMITED on 429 / INTERNET_CONNECTION_PROBLEM on
        // network); a local re-push duplicated it. BUT mutationFn has a SECOND, CLIENT-SIDE step,
        // deliverExport (Blob/download or clipboard) AFTER the HTTP success, whose throw does NOT go
        // through the interceptor. Guard isIOError (usePlanChange pattern): the GENERAL_ERROR toast
        // is pushed ONLY for such a client-side throw, not for an HTTP error.
        onError: error => {
          if (!isIOError(error)) {
            pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
          }
        },
      }
    );
  };

  const failed = result?.delivery === 'clipboard-failed';

  return (
    <section className={styles.section} data-app-section='bordered'>
      <div className={styles.text}>
        <TypographyAtom
          variant='h4'
          className={styles.title}
          data-app-section-title=''>
          {t('sectionTitle')}
        </TypographyAtom>
        <p className={styles.lead}>{t('copyLabel')}</p>
      </div>

      <ButtonAtom
        variant='primary'
        size='md'
        icon={<DownloadSimpleIcon size={18} />}
        loading={isPending}
        onClick={handleExport}
        className={styles.action}>
        {isPending ? t('downloadingCta') : t('downloadCta')}
      </ButtonAtom>

      <CompletionLineMolecule
        state={
          isPending
            ? 'pending'
            : result === null
              ? 'idle'
              : failed
                ? 'error'
                : 'complete'
        }
        message={
          result === null
            ? t('copyCaption')
            : result.delivery === 'download'
              ? t('downloadedToast', { filename: result.filename })
              : result.delivery === 'clipboard'
                ? t('copiedToast')
                : t('copyFailedToast')
        }
        reserveMessage={t('copyCaption')}
      />
    </section>
  );
}
