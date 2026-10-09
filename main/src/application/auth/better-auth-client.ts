import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ENV_VARS } from '../environment/environment.config';
import { getFromClientStorage } from '../client-device-storage/clientStorage.possibilities.api';

const port = ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
const backendBaseURL = `${ENV_VARS.NEXT_PUBLIC_HTTP_PROTOCOL}${ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN}${port ? `:${port}` : ''}`;

// Backend uses Better Auth's `bearer()` plugin (web-1/.../better-auth.config.ts).
// We attach the stored bearer token to every Better Auth client fetch so
// `useSession()` re-hydrates after reload in WebView / cookieless contexts.
export const authClient = createAuthClient({
  baseURL: backendBaseURL,
  fetchOptions: {
    auth: {
      type: 'Bearer',
      token: () =>
        getFromClientStorage({ key: CUSTOM_HEADERS.authorization }) ?? '',
    },
  },
  // DECISION (nie usuwaj tego komentarza):
  // Wyłączamy refetch sesji na każdy window-focus. Domyślnie better-auth bije
  // /get-session przy KAŻDYM powrocie do karty (session-refresh.mjs:23 —
  // refetchOnWindowFocus ?? true), co na publicznym LP to czysty zbędny ruch
  // (sesja nie zmienia się od samego sfokusowania karty; cross-tab revoke i tak
  // łapie `storage` event w AuthContext). refetchInterval zostaje 0 (brak pollingu).
  sessionOptions: { refetchOnWindowFocus: false },
  plugins: [magicLinkClient()],
});

export const { signIn, signOut } = authClient;
