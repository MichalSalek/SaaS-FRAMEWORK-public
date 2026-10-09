// UI/features/account/components/DataExportSection.organism.tsx
// [LC-07] GDPR Art. 15 / 20 — Data Export UI in Account settings.
// The one action of the „Dane” section: POSTs to the export endpoint and hands
// the JSON to the device (file download on the web, clipboard in the native
// shell). Backend enforces a 1-per-24h rate limit; the rate-limit event is
// surfaced via snackbar (HTTP interceptor).
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useState } from 'react';
import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
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
  // DECISION (nie usuwaj tego komentarza) — 2026-10-08:
  // wynik eksportu ZOSTAJE na ekranie, w linii pod przyciskiem. Wcześniej
  // mówił o nim wyłącznie toast, który znikał po kilku sekundach, a ekran
  // wracał do stanu sprzed kliknięcia: nie było widać, czy plik jest i gdzie.
  // Linia jest zamontowana zawsze (w spoczynku niesie opis pliku), więc nic
  // się nie przesuwa, gdy pojawia się wynik. Toastu sukcesu już nie ma: ten
  // sam fakt powiedziany dwa razy.
  const [result, setResult] = useState<ExportResult | null>(null);

  const handleExport = () => {
    if (isPending) {
      return;
    }
    setResult(null);
    mutate(
      {},
      {
        // Wynik mówi PRAWDĘ o miejscu docelowym (owner 2026-07-11 — generyczne
        // „wyeksportowano" nie mówiło GDZIE): web = nazwa pobranego pliku,
        // native (WebView bez DownloadListenera) = schowek.
        onSuccess: setResult,
        // DECISION (nie usuwaj tego komentarza):
        // Błąd HTTP eksportu (exportUserData_IO) toastuje interceptor (event-bus
        // Stage 1: USER_DATA_EXPORT_RATE_LIMITED na 429 / INTERNET_CONNECTION_PROBLEM
        // na sieci) — lokalny re-push dublował go (inny string nigdy nie dedupuje).
        // ALE mutationFn ma DRUGI, CLIENT-SIDE krok — deliverExport (Blob/download
        // lub schowek) PO udanym HTTP — który przy rzuceniu NIE przechodzi przez
        // interceptor. Guard isIOError (wzorzec usePlanChange): toast GENERAL_ERROR
        // pushujemy WYŁĄCZNIE dla takiego client-side throw, nie dla błędu HTTP.
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
    <section className={styles.section}>
      <div className={styles.text}>
        <TypographyAtom variant='h4' className={styles.title}>
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

      <p
        className={styles.status}
        data-tone={result === null ? 'idle' : failed ? 'warning' : 'success'}
        role='status'>
        {result !== null && (
          <span className={styles.statusIcon} aria-hidden='true'>
            {failed ? (
              <WarningCircleIcon size={18} weight='fill' />
            ) : (
              <CheckCircleIcon size={18} weight='fill' />
            )}
          </span>
        )}
        <span>
          {result === null
            ? t('copyCaption')
            : result.delivery === 'download'
              ? t('downloadedToast', { filename: result.filename })
              : result.delivery === 'clipboard'
                ? t('copiedToast')
                : t('copyFailedToast')}
        </span>
      </p>
    </section>
  );
}
