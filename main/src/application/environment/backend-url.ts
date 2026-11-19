/**
 * Build the backend base URL from NEXT_PUBLIC_* env vars.
 *
 * Inlined into the client bundle by Next.js, so this works in browser, SSR,
 * Edge proxy, and server-side code without an `ENV_VARS` dependency.
 *
 * Returns an empty string when the domain is not configured — callers should
 * treat this as "backend unreachable" and degrade gracefully (no fetch).
 */
export const buildBackendBaseUrl = (): string => {
  const protocol = process.env.NEXT_PUBLIC_HTTP_PROTOCOL ?? 'https://';
  const domain = process.env.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN;
  const port = process.env.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
  if (!domain) {
    return '';
  }
  return `${protocol}${domain}${port ? `:${port}` : ''}`;
};
