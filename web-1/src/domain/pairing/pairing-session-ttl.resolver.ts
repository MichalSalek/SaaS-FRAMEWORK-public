import { getRuntimeConfigValue } from '@domain/admin/operations/admin-runtime-config.operations';
import { PAIRING_CONFIG } from './pairing.config';

// DECISION: the token TTL (minutes) comes from the runtime-config override PAIRING_SESSION_TTL_MINUTES with a
// HARD security clamp. getRuntimeConfigValue returns a raw DB string; although the admin validator enforces
// min:1/max:60, this defence-in-depth clamp guarantees an out-of-range, NaN or stale row can never extend the
// token lifetime past 60 min (the token is a short-lived offline-to-online QR bridge). The default is
// PAIRING_CONFIG.TOKEN_TTL_MINUTES (15) when unset or invalid.
const MAX_PAIRING_TTL_MINUTES = 60;

export const resolvePairingTtlMinutes = async (): Promise<number> => {
  const raw = await getRuntimeConfigValue(
    'PAIRING_SESSION_TTL_MINUTES',
    String(PAIRING_CONFIG.TOKEN_TTL_MINUTES)
  );
  const parsed = Number(raw);
  const isValid =
    Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_PAIRING_TTL_MINUTES;
  if (!isValid) {
    return PAIRING_CONFIG.TOKEN_TTL_MINUTES;
  }
  return parsed;
};
