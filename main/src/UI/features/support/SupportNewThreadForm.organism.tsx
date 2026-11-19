// UI/features/support/SupportNewThreadForm.organism.tsx
// The form of the new-request screen: a category picked from a list (nobody
// types a subject; the server derives the thread title from the message) and
// the message itself.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import { SUPPORT_LENGTHS } from '@kernel/policies/validation.config';
import { supportValidators } from '@kernel/policies/validation/support.validation';
import type { SupportThreadCategory } from '@kernel/models/support/support.dto';
import { buildRoute } from '../../../application/routing/buildRoute';
import { bypassLeaveGuard } from '../../../application/routing/leave-guard';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { SelectAtom } from '../../components/Select/Select.atom';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { useLeaveGuard } from '../../shared/hooks/useLeaveGuard';
import { useCreateSupportThread } from './hooks/useCreateSupportThread';
import {
  SUPPORT_CATEGORIES,
  readCategoryParam,
} from './supportCategory.helpers';
import styles from './SupportNewThreadPage.module.css';

const V = VALIDATION_MESSAGES.support;

/** '' = nothing picked yet (the select shows its placeholder). */
type CategoryChoice = SupportThreadCategory | '';

export function SupportNewThreadFormOrganism() {
  const t = useTranslations('pages.support');
  const tValidation = useTranslations('validation.support');
  const router = useRouter();
  const nav = useNativeRouter();
  const [category, setCategory] = useState<CategoryChoice>('');
  const [message, setMessage] = useState('');
  // Errors appear after the first attempt to send and then follow the fields
  // live, so a corrected field clears at once.
  const [attempted, setAttempted] = useState(false);
  const [shake, setShake] = useState(false);
  const createMutation = useCreateSupportThread();
  const isSending = createMutation.isPending;

  // A statically generated page learns its query only after hydration, so the
  // `?category=` preselection arrives in an effect. It never overrides a
  // choice the user has already made.
  const categoryParam = router.isReady
    ? readCategoryParam(router.query.category)
    : null;
  useEffect(() => {
    if (categoryParam !== null) {
      setCategory(current => (current === '' ? categoryParam : current));
    }
  }, [categoryParam]);

  useLeaveGuard({
    when: message.trim().length > 0,
    message: t('newThreadLeaveConfirm'),
  });

  // The same validator the server runs (kernel), so the form and the API
  // cannot disagree about what a valid request is.
  const request = { category, message: message.trim() };
  const validation = supportValidators.createSupportThread(request);

  // One key per field per failure (DECISION in support.validation.ts).
  const fieldError = (raw: string): string | undefined => {
    switch (raw.trim()) {
      case V.categoryRequired:
        return tValidation('categoryRequired');
      case V.messageRequired:
        return tValidation('messageRequired');
      case V.messageTooShort:
        return tValidation('messageTooShort');
      case V.messageTooLong:
        return tValidation('messageTooLong');
      default:
        return undefined;
    }
  };
  const categoryError = attempted ? fieldError(validation.category) : undefined;
  const messageError = attempted ? fieldError(validation.message) : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) {
      return;
    }
    if (!validation.__isValid || category === '') {
      setAttempted(true);
      setShake(true);
      return;
    }
    createMutation.mutate(
      { category, message: request.message },
      {
        onSuccess: ({ thread_id }) => {
          // The request is saved: leaving now loses nothing, so the unsaved
          // text guard must not ask on the way to the created thread.
          bypassLeaveGuard();
          nav.replace(
            buildRoute(ROUTES_FRONT.SUPPORT_THREAD, { threadId: thread_id })
          );
        },
        // The toast belongs to the HTTP interceptor; everything typed stays.
        onError: () => setShake(true),
      }
    );
  };

  const options = SUPPORT_CATEGORIES.map(value => ({
    value,
    label: t(`categories.${value}`),
  }));

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <SelectAtom
        label={t('newThreadCategoryLabel')}
        placeholder={t('newThreadCategoryPlaceholder')}
        options={options}
        value={category}
        onChange={event =>
          setCategory(readCategoryParam(event.target.value) ?? '')
        }
        disabled={isSending}
        error={categoryError}
      />

      <div className={styles.field}>
        <InputAtom
          multiline
          label={t('newThreadMessageLabel')}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={t('newThreadMessagePlaceholder')}
          rows={6}
          maxLength={SUPPORT_LENGTHS.MESSAGE_MAX}
          disabled={isSending}
          error={messageError}
        />
        {/* Always mounted: the counter never pushes the buttons around. */}
        <span className={styles.counter}>
          {t('newThreadCounter', {
            count: message.length,
            max: SUPPORT_LENGTHS.MESSAGE_MAX,
          })}
        </span>
      </div>

      <p className={styles.privacyNote}>
        {t.rich('newThreadPrivacyNote', {
          privacyLink: chunks => (
            <Link prefetch={false} href={ROUTES_FRONT.PRIVACY}>
              {chunks}
            </Link>
          ),
        })}
      </p>

      <div className={styles.actions}>
        <ButtonAtom
          variant='primary'
          size='lg'
          type='submit'
          className={styles.submit}
          shake={shake}
          onShakeEnd={() => setShake(false)}
          loading={isSending}>
          {t('newThreadSubmit')}
        </ButtonAtom>
        {/* Locked while the request is in flight: leaving mid-send let the
            thread be created (or fail) behind the user's back. With text typed
            the leave guard asks first. */}
        <ButtonAtom
          variant='text'
          size='md'
          type='button'
          disabled={isSending}
          onClick={() => nav.push(ROUTES_FRONT.SUPPORT)}>
          {t('cancel')}
        </ButtonAtom>
      </div>
    </form>
  );
}
