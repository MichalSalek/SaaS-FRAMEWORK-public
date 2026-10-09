// tests/prod/prod-auth.ts
//
// Logowanie na produkcji dokładnie tą drogą, którą idzie użytkownik:
// prośba o magic-link → odbiór maila po IMAP → otwarcie linku → wymiana
// jednorazowego kodu na token sesji (wariant C, patrz web-1 auth-token-bridge).
//
// Ten plik jest odpowiedzią na notatkę z tests/smoke/exchange-code.smoke.ts,
// która pełny przebieg kodu wymiany opisywała jako „do wyklikania przez
// właściciela" — od teraz przechodzi go automat, bez ani jednej furtki
// dorobionej w produkcyjnym kodzie.

import { PROD_CONFIG } from './prod-config';
import { purgeInbox, waitForMessage } from './prod-inbox';

const MAGIC_LINK_RE =
  /https?:\/\/[^\s"'<>]+\/api\/auth\/magic-link\/verify\?[^\s"'<>]+/;

export interface ProdSession {
  token: string;
  email: string;
  /** Adres, na którym wylądował łańcuch przekierowań (z ?authCode). */
  landingUrl: string;
}

/** Prosi backend o magic-link dla podanego adresu. */
export async function requestMagicLink(
  email: string,
  callbackURL = '/app'
): Promise<void> {
  const response = await fetch(
    `${PROD_CONFIG.BACKEND_URL}/api/auth/sign-in/magic-link`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PROD_CONFIG.FRONTEND_URL,
      },
      body: JSON.stringify({ email, callbackURL }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Wysyłka magic-linka odrzucona: HTTP ${response.status} ${await response.text()}`
    );
  }
}

/**
 * Idzie łańcuchem przekierowań od linku z maila aż do adresu z `?authCode`.
 * Ręcznie, hop po hopie, bo interesuje nas nie tylko wynik, ale i to, że most
 * tokenowy faktycznie przepisał adres na origin frontu (regresja z tego miejsca
 * potrafi zostawić użytkownika zalogowanego „w backendzie", czyli nigdzie).
 */
export async function followToAuthCode(magicLinkUrl: string): Promise<string> {
  let current = magicLinkUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    const url = new URL(current);
    const authCode = url.searchParams.get('authCode');
    if (authCode) {
      return current;
    }
    // Nieudana weryfikacja linku wraca z kodem błędu zamiast kodu wymiany —
    // nazwijmy to po imieniu, zamiast raportować „urwane przekierowanie".
    const errorCode = url.searchParams.get('error');
    if (errorCode) {
      throw new Error(
        `Link logowania odrzucony przez backend: ${errorCode} (adres ${url.pathname}).`
      );
    }
    const response = await fetch(current, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(
        `Przekierowanie urwało się na ${url.pathname} (HTTP ${response.status}) bez authCode.`
      );
    }
    current = new URL(location, current).toString();
  }
  throw new Error('Za dużo przekierowań w drodze po authCode (pętla?).');
}

/** Wymienia jednorazowy kod na token sesji (nagłówek `authorization`). */
export async function exchangeCodeForToken(authCode: string): Promise<string> {
  const response = await fetch(
    `${PROD_CONFIG.BACKEND_URL}/api/auth/exchange-code`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PROD_CONFIG.FRONTEND_URL,
      },
      body: JSON.stringify({ authCode }),
    }
  );
  const token = response.headers.get('authorization');
  if (!response.ok || !token) {
    throw new Error(
      `Wymiana kodu na sesję nie powiodła się: HTTP ${response.status}, nagłówek authorization ${
        token ? 'obecny' : 'brak'
      }`
    );
  }
  return token;
}

/**
 * Pełne logowanie na produkcji. Zwraca token sesji gotowy do użycia jako
 * `Authorization: Bearer …` w wywołaniach API oraz jako wpis
 * `localStorage['authorization']` w teście przeglądarkowym.
 */
export async function loginViaMagicLink(options?: {
  email?: string;
  callbackURL?: string;
}): Promise<ProdSession> {
  const email = options?.email ?? PROD_CONFIG.MAILBOX_USER;
  // Skrzynkę czyścimy PRZED prośbą, bo magic-link jest jednorazowy: bez tego
  // kolejny przebieg potrafi chwycić list z poprzedniego (token już spalony) i
  // zgłosić „nieprawidłowy link" tam, gdzie logowanie jest całkiem zdrowe.
  // Sam znacznik czasu na to nie wystarcza — zegary maszyny i serwera pocztowego
  // nie chodzą równo, więc margines musi być luźny, a luźny margines łapie
  // stare listy.
  await purgeInbox();
  const since = new Date(Date.now() - 60_000);

  await requestMagicLink(email, options?.callbackURL ?? '/app');
  const { matched } = await waitForMessage({ since, match: MAGIC_LINK_RE });
  const landingUrl = await followToAuthCode(matched);
  const authCode = new URL(landingUrl).searchParams.get('authCode') ?? '';
  const token = await exchangeCodeForToken(authCode);

  return { token, email, landingUrl };
}

/** Zamyka sesję, żeby test nie zostawiał po sobie żywych tokenów na produkcji. */
export async function signOut(token: string): Promise<void> {
  await fetch(`${PROD_CONFIG.BACKEND_URL}/api/auth/sign-out`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      origin: PROD_CONFIG.FRONTEND_URL,
    },
  }).catch(() => undefined);
}
