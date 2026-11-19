import type { QueryClient } from '@tanstack/react-query';
import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { getFromClientStorage } from '../../../../application/client-device-storage/clientStorage.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

type Session = {
  isPending: boolean;
  error: unknown;
  data?: { user?: { id?: string } } | null;
};
type Identity = {
  userId: string;
  accountId: string;
  token: string;
  becomeUser: string | null;
};
export class GalleryUploadIdentityChanged extends Error {}

export function galleryUploadIdentity(
  cache: QueryClient,
  session: Session
): Identity | null {
  const token = getFromClientStorage({ key: CUSTOM_HEADERS.authorization });
  const becomeUser = getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
  const user = cache.getQueryData<SafeCurrentUserWire>(
    queryKeys.account.current
  );
  const accountId = user?.stylist_account?.account_id;
  if (
    !token ||
    session.isPending ||
    session.error != null ||
    !user?.id ||
    !accountId ||
    session.data?.user?.id !== user.id
  ) {
    return null;
  }
  return { userId: user.id, accountId, token, becomeUser };
}

export function sameGalleryUploadIdentity(
  a: Identity,
  b: Identity | null
): boolean {
  return (
    b !== null &&
    a.userId === b.userId &&
    a.accountId === b.accountId &&
    a.token === b.token &&
    a.becomeUser === b.becomeUser
  );
}
