export type AppStateListener = (state: { isActive: boolean }) => void;

export async function onAppStateChange(
  listener: AppStateListener
): Promise<() => void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return () => {};
    }

    const { App } = await import('@capacitor/app');
    const handle = await App.addListener(
      'appStateChange',
      ({ isActive }: { isActive: boolean }) => {
        listener({ isActive });
      }
    );
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}
