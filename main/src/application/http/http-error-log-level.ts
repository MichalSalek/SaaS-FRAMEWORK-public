import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export function httpErrorLogLevel(
  status: number,
  event: string,
  url: string,
  rejectionData: unknown
): 'warn' | 'error' {
  const isExpectedExchangeMiss =
    status === 404 &&
    (event === APP_EVENTS.INFO.USER.LOGIN_TOKEN_EXCHANGE_FAILED ||
      url.includes('/api/auth/exchange-code'));
  const isMissingClientProfile =
    status === 404 && url.includes('/api/v1/client/profile');
  const isStalePlanQuote =
    status === 409 &&
    event === APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED &&
    rejectionData != null &&
    typeof rejectionData === 'object' &&
    'field' in rejectionData &&
    rejectionData.field === 'quoteId';
  const isRecoverableRejection =
    isStalePlanQuote ||
    status === 429 ||
    (status === 403 &&
      event === APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO);
  return isExpectedExchangeMiss ||
    isMissingClientProfile ||
    isRecoverableRejection
    ? 'warn'
    : 'error';
}
