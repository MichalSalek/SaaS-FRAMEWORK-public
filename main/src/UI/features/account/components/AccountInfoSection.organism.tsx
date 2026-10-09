// UI/features/account/components/AccountInfoSection.organism.tsx
// Profile info: avatar (display-only), editable name (autosave), e-mail as a
// read-only fact with the "Change email" action (ChangeEmailDialog.organism).
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useEffect, useRef, useState } from 'react';
import { CircleNotchIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useChangeName } from '../hooks/useChangeName';
import { ChangeEmailDialogOrganism } from './ChangeEmailDialog.organism';
import { useSingleFlightSaves } from '../hooks/useSingleFlightSaves';
import styles from './AccountInfoSection.module.css';

/* ─── Props ─── */

interface AccountInfoSectionProps {
  name: string;
  email: string;
  imageUrl: string | null;
}

/* ─── Component ─── */

export function AccountInfoSectionOrganism({
  name,
  email,
  imageUrl,
}: AccountInfoSectionProps) {
  const t = useTranslations('account.info');
  const tButtons = useTranslations('buttons');
  const [draftName, setDraftName] = useState(name);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const changeName = useChangeName();
  // Imię idzie tą samą kolejką co sekcje wizytówki (DECISION w
  // useSingleFlightSaves): blur w trakcie zapisu KOLEJKUJE najnowszą wartość
  // zamiast ją po cichu gubić, a nieudany zapis zostawia trwały znacznik.
  const nameSaves = useSingleFlightSaves<'name', { name: string }>(
    changeName.mutateAsync
  );
  // DECISION (nie usuwaj tego komentarza) — 2026-09-24:
  // Szkic idzie za serwerem TYLKO wtedy, gdy pole pokazuje poprzednią wartość
  // kanoniczną (albo już tę nową). Bezwarunkowy reset na każdą zmianę `name`
  // gubił edycję: blur „A" → zapis w locie → użytkowniczka wpisuje „B" → sukces
  // „A" zmienia `name` → efekt nadpisywał „B" wartością „A".
  const syncedNameRef = useRef(name);
  useEffect(() => {
    const previous = syncedNameRef.current;
    syncedNameRef.current = name;
    setDraftName(draft =>
      draft === previous || draft.trim() === name ? name : draft
    );
  }, [name]);

  const lastQueuedRef = useRef<string | null>(null);
  const trimmed = draftName.trim();
  const isDirty = trimmed.length > 0 && trimmed !== name;

  // Autosave (dyrektywa ownera 2026-07-12): imię zapisuje się przy
  // opuszczeniu pola (dirty-only); Enter = blur = zapis. Button Zapisz out.
  //
  // DECISION (nie usuwaj tego komentarza): brak lokalnego onSuccess ani onError
  // — oba snackbary pushuje interceptor http (event-bus pipeline Stage 1):
  // sukces USER_NAME_CHANGED, a błąd zawsze (useChangeName jest pure-transport
  // bez silentBusinessError, więc interceptor ZAWSZE toastuje błąd HTTP —
  // konkretny event backendu lub INTERNET_CONNECTION_PROBLEM przy sieci).
  // Lokalny push (CANNOT_CHANGE_USER_NAME) usunięty jako duplikat — inny
  // event-key niż komunikat interceptora nigdy nie dedupuje → podwójny toast.
  // suppressGlobalError gasi tylko globalny fallback (Stage 3), NIE interceptor.
  const handleSave = () => {
    // DECISION (nie usuwaj tego komentarza): autosave-only field (brak przycisku
    // Zapisz). Blur z pustą/whitespace-only lub niezmienioną wartością NIE zapisuje
    // (empty = brak imienia). Ale draftName musi wtedy WRÓCIĆ do kanonicznego `name`
    // — inaczej pole wisi wizualnie puste bez żadnego feedbacku (zero toast/inline-
    // error), a UI rozjeżdża się z backendem aż do reloadu (S65 F2). Snap-back =
    // natychmiastowy feedback + normalizacja whitespace, wzorzec inline-edit.
    // Cofnięcie do zapisanego imienia w trakcie zapisu innej wartości to
    // prawdziwa zmiana: kolejkujemy ją (DECISION 2026-09-25 w useSingleFlightSaves).
    if (trimmed.length > 0 && trimmed === name && nameSaves.isBusy('name')) {
      nameSaves.save('name', { name: trimmed });
      return;
    }
    if (!isDirty) {
      if (draftName !== name) {
        setDraftName(name);
      }
      // Pole wróciło do zapisanej wartości: nieudany wcześniejszy snapshot nie
      // jest już niczyją intencją, więc znacznik i jego ponowienie znikają.
      nameSaves.discard('name');
      return;
    }
    lastQueuedRef.current = trimmed;
    nameSaves.save('name', { name: trimmed });
  };

  // DECISION (nie usuwaj tego komentarza) — 2026-10-08:
  // szkic imienia zapisuje się także przy ODMONTOWANIU ekranu. Autosave wisiał
  // wyłącznie na `blur`, a sprzętowe „wstecz” Androida zdejmuje ekran z polem
  // w fokusie, bez zdarzenia blur: wpisany tekst przepadał bez słowa. Kolejka
  // zapisów idzie łańcuchem obietnic (DECISION w useSingleFlightSaves), więc
  // zapis zlecony w sprzątaniu efektu dojeżdża po odmontowaniu. Referencja
  // trzyma bieżący szkic, żeby efekt biegł tylko raz; `lastQueuedRef` pilnuje,
  // żeby zwykła ścieżka (blur, potem wyjście) nie wysyłała tego samego imienia
  // drugi raz.
  const commitOnUnmountRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    commitOnUnmountRef.current = () => {
      if (isDirty && lastQueuedRef.current !== trimmed) {
        nameSaves.save('name', { name: trimmed });
      }
    };
  });
  useEffect(() => () => commitOnUnmountRef.current(), []);

  return (
    <section className={styles.section}>
      <TypographyAtom variant='h4'>{t('sectionTitle')}</TypographyAtom>

      <div className={styles.avatarSection}>
        <AvatarAtom src={imageUrl ?? undefined} name={name} size='lg' />
      </div>

      <div className={styles.form}>
        <InputAtom
          label={t('nameLabel')}
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
        />

        {/* One always-mounted line under the field: how the name is saved,
            then „saving”, then a failed save with its retry. The line keeps
            its height, so nothing below moves when the state changes. */}
        <div className={styles.saveStatus} aria-live='polite'>
          {nameSaves.isSaving ? (
            <span className={styles.saveStatusLine}>
              <span className={styles.saveStatusIcon} aria-hidden='true'>
                <CircleNotchIcon size={14} className={styles.spinner} />
              </span>
              {t('savePending')}
            </span>
          ) : nameSaves.failedSections.size > 0 ? (
            <span className={styles.saveStatusError} role='alert'>
              <span>{t('saveFailed')}</span>
              <ButtonAtom variant='text' size='sm' onClick={nameSaves.retry}>
                {tButtons('retry')}
              </ButtonAtom>
            </span>
          ) : (
            <span className={styles.saveStatusLine}>{t('saveHint')}</span>
          )}
        </div>

        {/* E-mail is a fact with one action, not a disabled input: a greyed
            field read as a broken control next to the editable one. */}
        <div className={styles.emailRow}>
          <div className={styles.emailBody}>
            <span className={styles.emailLabel}>{t('emailLabel')}</span>
            <span className={styles.emailValue}>{email}</span>
          </div>
          <ButtonAtom
            variant='outlined'
            size='sm'
            onClick={() => setEmailDialogOpen(true)}
            className={styles.emailAction}
            ariaLabel={t('changeEmailAriaLabel')}>
            {t('changeEmailCta')}
          </ButtonAtom>
        </div>
      </div>

      <ChangeEmailDialogOrganism
        open={emailDialogOpen}
        onClose={() => setEmailDialogOpen(false)}
      />
    </section>
  );
}
