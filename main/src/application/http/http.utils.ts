import { getFromClientStorage } from '../../application/client-device-storage/clientStorage.possibilities.api';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

export const requestHeadersSetter = async (): Promise<
  Record<string, string>
> => {
  const authorization = getFromClientStorage({
    key: CUSTOM_HEADERS['authorization'],
  });

  const becomeUser = getFromClientStorage({
    key: CUSTOM_HEADERS['becomeUser'],
  });

  const pathname =
    typeof location !== 'undefined'
      ? window.location.pathname
      : 'NOT_FROM_BROWSER';

  return {
    [CUSTOM_HEADERS['userMetadata']]: '{}',
    // DECISION: the Better Auth bearer plugin (backend getCurrentUser_IO → auth.api.getSession)
    // requires the header as "Bearer <token>" (it checks slice(0,7).toLowerCase()==='bearer ').
    // localStorage holds the RAW token (dev-login/become-user stamp it unprefixed; the
    // better-auth-client adds "Bearer " itself). This custom v1 adapter MUST do the same, or
    // getSession rejects the raw token and currentUser is undefined on EVERY v1 endpoint. A token that
    // already has the prefix is left as is.
    [CUSTOM_HEADERS['authorization']]: authorization
      ? authorization.startsWith('Bearer ')
        ? authorization
        : `Bearer ${authorization}`
      : '',
    [CUSTOM_HEADERS['becomeUser']]: becomeUser ?? '',
    [CUSTOM_HEADERS['pathname']]: pathname,
  };
};
