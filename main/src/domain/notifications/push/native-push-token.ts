import type {
  PluginListenerHandle,
  PushNotificationsPlugin,
} from './native-push';

/** register() only starts registration; the token or registrationError arrives via a listener. */
export async function obtainToken(
  plugin: PushNotificationsPlugin
): Promise<string> {
  const handles: PluginListenerHandle[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let armed = false;
  try {
    let resolveToken!: (value: string) => void;
    let rejectToken!: (error: Error) => void;
    const result = new Promise<string>((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });
    handles.push(
      await plugin.addListener('registration', token => {
        if (!armed) {
          return;
        }
        if (token.value) {
          resolveToken(token.value);
        } else {
          rejectToken(new Error('Empty native push token'));
        }
      })
    );
    handles.push(
      await plugin.addListener('registrationError', error => {
        if (armed) {
          rejectToken(new Error(error.error));
        }
      })
    );
    timeout = setTimeout(
      () => rejectToken(new Error('Native push registration timed out')),
      30_000
    );
    armed = true;
    void plugin
      .register()
      .catch(error =>
        rejectToken(
          error instanceof Error
            ? error
            : new Error('Native push registration failed')
        )
      );
    return await result;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    await Promise.all(
      handles.map(handle => handle.remove().catch(() => undefined))
    );
  }
}
