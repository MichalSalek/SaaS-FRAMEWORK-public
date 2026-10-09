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
    // DECISION (nie usuwaj tego komentarza):
    // Better Auth bearer plugin (backend getCurrentUser_IO -> auth.api.getSession)
    // wymaga naglowka w formacie "Bearer <token>" (plugin sprawdza
    // slice(0,7).toLowerCase()==='bearer '). localStorage trzyma RAW token
    // (dev-login/become-user stempluja go bez prefiksu; better-auth-client dokleja
    // "Bearer " sam przy wysylce — auth.type:'Bearer'). Ten custom v1 adapter MUSI
    // zrobic to samo, inaczej getSession odrzuca surowy token -> currentUser
    // undefined na KAZDYM v1 endpoincie (get-current itd.). Idempotentnie, by nie
    // podwoic prefiksu gdyby token juz go mial.
    [CUSTOM_HEADERS['authorization']]: authorization
      ? authorization.startsWith('Bearer ')
        ? authorization
        : `Bearer ${authorization}`
      : '',
    [CUSTOM_HEADERS['becomeUser']]: becomeUser ?? '',
    [CUSTOM_HEADERS['pathname']]: pathname,
  };
};
