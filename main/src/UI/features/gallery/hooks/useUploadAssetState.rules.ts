import { activationLatchKey } from '../../../../application/client-device-storage/storage-keys.config';
import {
  getFromClientStorage,
  setToClientStorage,
} from '../../../../application/client-device-storage/clientStorage.possibilities.api';
import { getQuotaFailureFeature } from '../../../../application/pricing/quota.helpers';
import { isIOError } from '../../../../application/http/io';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

export function isUploadQuotaLimitError(error: unknown): boolean {
  return (
    getQuotaFailureFeature(
      'gallery',
      flowErrorCode(error),
      isIOError(error) ? error.httpError.data : undefined
    ) === 'gallery'
  );
}

export const firstPhotoOutcomeKey = (
  accountId: string | null
): string | null =>
  accountId ? `${activationLatchKey(accountId)}:first-photo` : null;
export function isFirstPhotoOutcomeEligible(
  count: number | undefined,
  accountId: string | null,
  keyOrCelebrated: string | boolean | null
): boolean {
  const alreadyCelebrated =
    typeof keyOrCelebrated === 'string'
      ? getFromClientStorage({ key: keyOrCelebrated }) === 'true'
      : keyOrCelebrated === true;
  return count === 0 && accountId !== null && !alreadyCelebrated;
}
export const markFirstPhotoOutcome = (key: string): boolean => {
  setToClientStorage({ key, value: 'true' });
  return getFromClientStorage({ key }) === 'true';
};
