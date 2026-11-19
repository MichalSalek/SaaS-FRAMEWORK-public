import { CLEAR_THIS_HEADER_COMMAND_VALUE } from '@kernel/application/http/http.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import {
  deleteFromClientStorage,
  setToClientStorage,
} from '../client-device-storage/clientStorage.possibilities.api';
import { withSessionTokenLock } from '../auth/session-token-lock';
import {
  bindDocumentCredentials,
  currentCredentialsMatch,
  readDocumentCredentials,
  type DocumentCredentials,
} from '../auth/document-credentials';

type OnEveryCallHeadersInterceptor = {
  headers: Record<string, string> | undefined;
  /** CallHTTPEndpointConfig.captureResponseAuthorization: when present, the
   *  response bearer goes to the caller and storage is left untouched. */
  captureAuthorization?: ((token: string) => void) | undefined;
  requestCredentials?: DocumentCredentials | undefined;
};

export const onEveryCallHeadersSideEffectInterceptor = async ({
  headers,
  captureAuthorization,
  requestCredentials,
}: OnEveryCallHeadersInterceptor) => {
  if (!headers) {
    return void undefined;
  }
  if (captureAuthorization) {
    const authorization = headers[CUSTOM_HEADERS.authorization];
    if (authorization && authorization !== CLEAR_THIS_HEADER_COMMAND_VALUE) {
      captureAuthorization(authorization);
    }
    return undefined;
  }
  return withSessionTokenLock(() => {
    if (requestCredentials && !currentCredentialsMatch(requestCredentials)) {
      return undefined;
    }

    // Authorization token from response (e.g. restored after become-user switch-back)
    const authorizationValue = headers[CUSTOM_HEADERS['authorization']];
    if (
      authorizationValue &&
      authorizationValue !== CLEAR_THIS_HEADER_COMMAND_VALUE
    ) {
      setToClientStorage({
        key: CUSTOM_HEADERS['authorization'],
        value: authorizationValue,
      });
    }
    // Defensive branch: the backend currently sends CLEAR only on the becomeUser
    // header (switch-back), never on authorization — kept as cheap protection in
    // case a future response ever asks to drop the auth token. A capturing call
    // owns no storage, so it never clears either.
    if (authorizationValue === CLEAR_THIS_HEADER_COMMAND_VALUE) {
      deleteFromClientStorage({ key: CUSTOM_HEADERS['authorization'] });
    }

    // Become user authorization (admin impersonation - kept for admin functionality).
    // Same set/clear contract as the authorization branch above: a CLEAR command
    // value is never persisted, only real tokens are.
    const switchUserValue = headers[CUSTOM_HEADERS['becomeUser']];
    if (
      switchUserValue &&
      switchUserValue !== CLEAR_THIS_HEADER_COMMAND_VALUE
    ) {
      setToClientStorage({
        key: CUSTOM_HEADERS['becomeUser'],
        value: switchUserValue,
        sessionOnly: true,
      });
    }
    if (switchUserValue === CLEAR_THIS_HEADER_COMMAND_VALUE) {
      deleteFromClientStorage({ key: CUSTOM_HEADERS['becomeUser'] });
    }
    if (authorizationValue || switchUserValue) {
      const updated = readDocumentCredentials();
      // A response to an authenticated document can switch identities (admin impersonation).
      // Keep its old binding until the expected full navigation replaces the document.
      if (
        !requestCredentials?.authorization ||
        requestCredentials.authorization === updated.authorization
      ) {
        bindDocumentCredentials();
      }
      return updated;
    }
    return undefined;
  });
};
