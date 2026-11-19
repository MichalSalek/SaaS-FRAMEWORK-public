import { usePostHogIdentify } from './usePostHogIdentify';

/**
 * Render-null bridge: mounts session→PostHog identify inside the auth provider
 * tree (_app.tsx), sibling to PostHogProvider.
 */
export function PostHogIdentifyBridge() {
  usePostHogIdentify();
  return null;
}
