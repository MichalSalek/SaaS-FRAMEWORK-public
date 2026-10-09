// UI/features/support/SupportComposeBar.tsx
// Compose dock — Slack-quality message input with prominent send button.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PaperPlaneRightIcon } from '@phosphor-icons/react';
import { SUPPORT_LENGTHS } from '@kernel/policies/validation.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useAddSupportMessage } from './hooks/useAddSupportMessage';
import {
  composerDraftKey,
  useComposerDraft,
} from '../messaging/hooks/useComposerDraft';
import styles from './SupportThreadDetailPage.module.css';

// SSOT for support message caps — mirrors server-side validation
const MESSAGE_MAX = SUPPORT_LENGTHS.MESSAGE_MAX;
const MESSAGE_MIN = SUPPORT_LENGTHS.MESSAGE_MIN;

export function SupportComposeBarOrganism({ threadId }: { threadId: string }) {
  const t = useTranslations('pages.support');
  // Draft survives leaving the thread and coming back (in-app navigation).
  const draftKey = composerDraftKey('support', threadId);
  const {
    value: content,
    setValue: setContent,
    clearFor: clearDraft,
  } = useComposerDraft(draftKey);
  const [isDesktop, setIsDesktop] = useState(false);
  const [shake, setShake] = useState(false);
  const addMessageMutation = useAddSupportMessage(threadId);

  // Detect desktop once on mount so we can show the Enter-to-send hint
  // only on devices with a real keyboard. Touch users rely on the Send btn.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const mq = window.matchMedia?.('(hover: hover) and (pointer: fine)');
    setIsDesktop(mq?.matches === true);
  }, []);

  const handleSend = () => {
    const trimmed = content.trim();
    // MIN-gate mirrors server validation (SUPPORT_LENGTHS.MESSAGE_MIN) — bez
    // niego send konczyl sie 400 z walidatora zamiast czytelnego UI-gate.
    // Enter-to-send moze trafic tu ponizej minimum (przycisk jest disabled,
    // ale klawiatura nie) — error-shake sygnalizuje "za krotka".
    if (trimmed.length < MESSAGE_MIN) {
      setShake(true);
      return;
    }
    // The field is read-only (not disabled) while sending so focus stays in
    // it; the keyboard can still fire Enter, so a second send is blocked here.
    if (addMessageMutation.isPending || draftKey === null) {
      return;
    }
    const sentKey = draftKey;
    addMessageMutation.mutate(
      { thread_id: threadId, content: trimmed },
      { onSuccess: () => clearDraft(sentKey), onError: () => setShake(true) }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // H10: Enter-to-send only on desktop. On touch devices (Capacitor mobile)
    // Enter must insert a newline — there is no Shift+Enter on mobile keyboards.
    // `isComposing`: Enter that confirms an IME candidate must not send.
    if (
      isDesktop &&
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      handleSend();
    }
  };

  const trimmedLength = content.trim().length;
  const canSend = trimmedLength >= MESSAGE_MIN && !addMessageMutation.isPending;
  const remaining = MESSAGE_MAX - content.length;
  // Show counter when user approaches the cap (within last 200 chars)
  const showCounter = content.length > 0 && remaining <= 200;
  // Inline hint: user juz pisze, ale jest ponizej serwerowego minimum.
  const showMinHint = trimmedLength > 0 && trimmedLength < MESSAGE_MIN;

  return (
    <div className={styles.composeDock}>
      <div className={styles.composeFrame}>
        <textarea
          className={styles.composeInput}
          value={content}
          onChange={e => setContent(e.target.value.slice(0, MESSAGE_MAX))}
          onKeyDown={handleKeyDown}
          placeholder={t('composePlaceholder')}
          rows={1}
          maxLength={MESSAGE_MAX}
          // readOnly, not disabled: a disabled field drops focus, so after
          // every reply the user had to tap back into the composer.
          readOnly={addMessageMutation.isPending}
          aria-busy={addMessageMutation.isPending}
          aria-label={t('composeAriaLabel')}
        />
        <ButtonAtom
          type='button'
          variant='primary'
          size='md'
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!canSend}
          aria-busy={addMessageMutation.isPending}
          ariaLabel={t('sendAriaLabel')}
          icon={<PaperPlaneRightIcon size={18} weight='fill' />}
          shake={shake}
          onShakeEnd={() => setShake(false)}
        />
      </div>
      {showMinHint ? (
        <TypographyAtom
          variant='caption'
          className={styles.composeHint}
          aria-live='polite'>
          {t('composeMinHint', { min: MESSAGE_MIN })}
        </TypographyAtom>
      ) : showCounter ? (
        <TypographyAtom
          variant='caption'
          className={styles.composeHint}
          aria-live='polite'>
          {remaining} / {MESSAGE_MAX}
        </TypographyAtom>
      ) : (
        isDesktop && (
          <TypographyAtom variant='caption' className={styles.composeHint}>
            {t('composeHintDesktop')}
          </TypographyAtom>
        )
      )}
    </div>
  );
}
