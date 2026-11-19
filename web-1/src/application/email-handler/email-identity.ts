import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
/** The approved brand signature is shared by every locale, template and transport. */
export const EMAIL_IDENTITY = {
  senderName: 'Ekipa Nailfolio!',
  address: BRAND_CONFIG.email.contact,
  replyTo: BRAND_CONFIG.email.support,
} as const;

export const getEmailIdentity = (
  transportAddress = EMAIL_IDENTITY.address
) => ({
  from: `${EMAIL_IDENTITY.senderName} <${transportAddress}>`,
  replyTo: EMAIL_IDENTITY.replyTo,
  senderName: EMAIL_IDENTITY.senderName,
});

/** Explicit reply destinations on owner-only contact alerts survive the default. */
export const getEmailHeaders = (
  headers: Record<string, string> = {}
): Record<string, string> => {
  const hasReplyTo = Object.keys(headers).some(
    key => key.toLowerCase() === 'reply-to'
  );
  return hasReplyTo
    ? headers
    : { ...headers, 'Reply-To': EMAIL_IDENTITY.replyTo };
};

export const getEmailReplyTo = (headers: Record<string, string> = {}): string =>
  Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'reply-to'
  )?.[1] ?? EMAIL_IDENTITY.replyTo;
