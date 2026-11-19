/**
 * Device Type Parser
 * Parses user agent string to determine device type
 */

export type DeviceType = 'unknown' | 'tablet' | 'mobile' | 'desktop';

export const parseDeviceType = (ua: string | null): DeviceType => {
  if (!ua) {
    return 'unknown';
  }

  if (/mobile|android|iphone|ipad/i.test(ua)) {
    return /ipad|tablet/i.test(ua) ? 'tablet' : 'mobile';
  }

  return 'desktop';
};
