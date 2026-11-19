import { useMemo, type ComponentProps } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useTrustedInteraction } from '../interaction/trusted-interaction';
import { mapContactMessages } from '../../../application/i18n/contact-messages';
import {
  getIntlMessageFallback,
  handleIntlError,
} from '../../../application/i18n/intl-error-handling';

/** SSR and hydration remain identical; only real browser input reveals contact text. */
export function ContactMessagesProviderComposition({
  messages,
  ...props
}: ComponentProps<typeof NextIntlClientProvider>) {
  const trusted = useTrustedInteraction();
  const visibleMessages = useMemo(
    () => mapContactMessages(messages, trusted ? 'revealed' : 'hidden'),
    [messages, trusted]
  );
  return (
    <NextIntlClientProvider
      onError={handleIntlError}
      getMessageFallback={getIntlMessageFallback}
      {...props}
      messages={visibleMessages ?? null}
    />
  );
}
