/** Mailgun wraps send-response Message-IDs in brackets but omits them in webhook headers. */
export const normalizeProviderMessageId = (
  provider: string,
  id: string
): string =>
  provider === 'mailgun' ? id.trim().replace(/^<([^<>]+)>$/, '$1') : id;
