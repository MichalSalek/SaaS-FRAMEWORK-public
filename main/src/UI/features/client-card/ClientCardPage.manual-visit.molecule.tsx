// UI/features/client-card/ClientCardPage.manual-visit.molecule.tsx
// „Dodaj wizytę”: THE main action of the client card. The button sits right
// under the intro; the form opens under it (an animated disclosure, always
// mounted, inert while closed).

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlusIcon } from '@phosphor-icons/react';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { DisclosurePanelAtom } from '../../components/Disclosure/DisclosurePanel.atom';
import styles from './ClientCardPage.module.css';

/** `datetime-local` value (local wall time, minute precision) for `date`. */
function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ManualVisitComposerMolecule({
  isPending,
  onCreate,
}: {
  isPending: boolean;
  /** Resolves when the visit is persisted; rejects on failure (toast by the
   *  http interceptor) — the form keeps its values so the stylist can retry. */
  onCreate: (payload: {
    visit_date: string;
    service_note?: string;
  }) => Promise<unknown>;
}) {
  const t = useTranslations('clientCard');
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState('');
  const [note, setNote] = useState('');
  // Picker ceiling = the end of today (local): the server refuses a visit more
  // than 24h ahead (visit.validation isNotFutureDate), so the picker should not
  // offer tomorrow+ only to have the save bounce with a toast. End of day, not
  // "now": any hour of today is inside the server tolerance, and a ceiling
  // frozen at the moment the form opened would reject "now" a few minutes later.
  const [maxValue, setMaxValue] = useState('');

  const submit = () => {
    if (!dateValue || isPending) {
      return;
    }
    const parsed = new Date(dateValue);
    // A half-typed value (text fallback where datetime-local is unsupported)
    // parses to Invalid Date, and toISOString() would throw in the handler.
    if (Number.isNaN(parsed.getTime())) {
      return;
    }
    const visitDate = parsed.toISOString();
    // Reset dopiero po sukcesie: czyszczenie przed wynikiem mutacji kasowało
    // wpisaną datę i notatkę, gdy zapis padł.
    onCreate({
      visit_date: visitDate,
      ...(note.trim() && { service_note: note.trim() }),
    })
      .then(() => {
        setDateValue('');
        setNote('');
        setOpen(false);
      })
      .catch(() => undefined);
  };

  const toggle = () => {
    if (!open) {
      const now = new Date();
      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 0, 0);
      setMaxValue(toDateTimeLocalValue(endOfToday));
      // Most visits are logged right after they happen: start from now.
      if (dateValue === '') {
        setDateValue(toDateTimeLocalValue(now));
      }
    }
    setOpen(prev => !prev);
  };

  return (
    <div className={styles.composer}>
      {/* Filled while it is the screen's main action; once the form is open
          the filled button is „Zapisz wizytę” and this one steps back. */}
      <ButtonAtom
        variant={open ? 'outlined' : 'primary'}
        size='md'
        icon={<CalendarPlusIcon size={18} />}
        className={styles.composerToggle}
        aria-expanded={open}
        aria-controls={formId}
        disabled={isPending}
        onClick={toggle}>
        {t('addManualVisit')}
      </ButtonAtom>

      <DisclosurePanelAtom id={formId} open={open}>
        {/* <form>: Enter in the date field saves, like every other form. */}
        <form
          className={styles.manualForm}
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}>
          <label className={styles.fieldLabel}>
            {t('visitDate')}
            <input
              className={styles.input}
              type='datetime-local'
              max={maxValue}
              value={dateValue}
              onChange={event => setDateValue(event.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            {t('serviceNote')}
            <textarea
              className={styles.smallTextarea}
              value={note}
              maxLength={VISIT_CONFIG.SERVICE_NOTE_MAX}
              placeholder={t('serviceNotePlaceholder')}
              onChange={event => setNote(event.target.value)}
            />
          </label>
          <div className={styles.formActions}>
            <ButtonAtom
              type='submit'
              variant='primary'
              size='md'
              aria-busy={isPending}
              disabled={!dateValue || isPending}>
              {isPending ? t('savingVisit') : t('saveVisit')}
            </ButtonAtom>
            <ButtonAtom
              type='button'
              variant='ghost'
              size='md'
              disabled={isPending}
              onClick={() => setOpen(false)}>
              {t('cancel')}
            </ButtonAtom>
          </div>
        </form>
      </DisclosurePanelAtom>
    </div>
  );
}
