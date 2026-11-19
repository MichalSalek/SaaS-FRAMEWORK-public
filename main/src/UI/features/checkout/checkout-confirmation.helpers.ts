/** Preserve the backend's locale, target plan and checkout source on SDK success. */
export function resolveCheckoutConfirmationUrl(
  returnUrl: string,
  sessionId: string
): string {
  return returnUrl.replace(
    '{CHECKOUT_SESSION_ID}',
    encodeURIComponent(sessionId)
  );
}
