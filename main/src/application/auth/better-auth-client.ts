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
  // DECISION: no session refetch on every window focus. better-auth's default hits /get-session on
  // each return to the tab (refetchOnWindowFocus ?? true), which on the public LP is pure waste: a
  // session does not change by focusing the tab, and the `storage` event in AuthContext already
  // catches cross-tab revoke. refetchInterval stays 0 (no polling).
  sessionOptions: { refetchOnWindowFocus: false },
  plugins: [magicLinkClient()],
});

export const { signIn, signOut } = authClient;
