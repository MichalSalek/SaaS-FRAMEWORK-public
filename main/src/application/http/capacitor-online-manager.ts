// main/src/application/http/capacitor-online-manager.ts
// Integrates @capacitor/network with TanStack Query's onlineManager.
// On native: uses Capacitor Network plugin for accurate online/offline detection.
// On web: graceful fallback to navigator.onLine (default TQ behavior).
//
// Bridge upgrade done: wrapper uses window.location.href + server.allowNavigation.
// Works on both native (Capacitor bridge active) and web (graceful no-op).

import { onlineManager } from '@tanstack/react-query';

export const initCapacitorOnlineManager = async (): Promise<void> => {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const { Network } = await import('@capacitor/network');

    const status = await Network.getStatus();
    onlineManager.setOnline(status.connected);

    await Network.addListener('networkStatusChange', newStatus => {
      onlineManager.setOnline(newStatus.connected);
    });
  } catch {
    // Web or plugin not available — TQ uses navigator.onLine by default
  }
};
