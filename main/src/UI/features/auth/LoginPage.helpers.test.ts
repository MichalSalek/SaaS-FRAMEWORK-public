import { describe, it, expect } from 'vitest';
import {
  resolvePostLoginTarget,
  isRegisterIntent,
  resolvePlanBannerName,
  isFromStylistProfile,
  resolveAuthErrorKey,
  isNativeAuthReturn,
  magicLinkSendErrorKey,
} from './LoginPage.helpers';
import {
  PricingPlanValue,
  getPlanDisplayName,
} from '@kernel/domain/pricing/pricing.config';

// ROUTES_FRONT values used in assertions (matching routing.config.ts):
//   ROUTES_FRONT.APP       = '/app'
//   ROUTES_FRONT.USER_LOG  = '/user/login'
const APP = '/app';

// ---------------------------------------------------------------------------
// resolvePostLoginTarget
// ---------------------------------------------------------------------------

describe('resolvePostLoginTarget', () => {
  it('returns the candidate when it is a valid local path', () => {
    expect(resolvePostLoginTarget('/app/dashboard')).toBe('/app/dashboard');
  });

  it('returns the candidate for any safe single-slash path', () => {
    expect(resolvePostLoginTarget('/some/deep/path?q=1')).toBe(
      '/some/deep/path?q=1'
    );
  });

  it('returns APP fallback for undefined', () => {
    expect(resolvePostLoginTarget(undefined)).toBe(APP);
  });

  it('returns APP fallback for empty string', () => {
    expect(resolvePostLoginTarget('')).toBe(APP);
  });

  it('returns APP fallback for protocol-relative URL (open-redirect guard)', () => {
    expect(resolvePostLoginTarget('//evil.com/steal')).toBe(APP);
  });

  it('returns APP fallback for absolute http URL', () => {
    expect(resolvePostLoginTarget('http://evil.com')).toBe(APP);
  });

  it('returns APP fallback for absolute https URL', () => {
    expect(resolvePostLoginTarget('https://evil.com')).toBe(APP);
  });

  it('returns APP fallback when path starts with /user/login (login-loop guard)', () => {
    expect(resolvePostLoginTarget('/user/login')).toBe(APP);
  });

  it('returns APP fallback when path starts with /user/login with query', () => {
    expect(resolvePostLoginTarget('/user/login?from=/app')).toBe(APP);
  });

  it('returns APP fallback for a locale-prefixed login path (login-loop guard)', () => {
    // window.location.pathname carries the i18n prefix, so `from` can be a
    // locale-prefixed login path — the loop guard must strip the locale first.
    expect(resolvePostLoginTarget('/pl/user/login')).toBe(APP);
    expect(resolvePostLoginTarget('/en/user/login?from=/app')).toBe(APP);
    expect(resolvePostLoginTarget('/de/user/login')).toBe(APP);
  });

  it('preserves the locale prefix on a safe locale-prefixed target', () => {
    // A genuine intended destination keeps its locale prefix so the user lands
    // on their own locale (only the loop comparison strips it, not the return).
    expect(resolvePostLoginTarget('/pl/app/dashboard')).toBe(
      '/pl/app/dashboard'
    );
    expect(resolvePostLoginTarget('/en/app/account')).toBe('/en/app/account');
  });

  it('takes first element when rawFrom is a non-empty array with a safe path', () => {
    expect(resolvePostLoginTarget(['/app/account', '/other'])).toBe(
      '/app/account'
    );
  });

  it('returns APP fallback when array is empty', () => {
    expect(resolvePostLoginTarget([])).toBe(APP);
  });

  it('returns APP fallback when array first element is unsafe (protocol-relative)', () => {
    expect(resolvePostLoginTarget(['//evil.com', '/safe'])).toBe(APP);
  });

  it('returns APP fallback when array first element is login path', () => {
    expect(resolvePostLoginTarget(['/user/login', '/app'])).toBe(APP);
  });
});

// ---------------------------------------------------------------------------
// isRegisterIntent
// ---------------------------------------------------------------------------

describe('isRegisterIntent', () => {
  it('returns true for "register"', () => {
    expect(isRegisterIntent('register')).toBe(true);
  });

  it('returns true for "signup" (synonym)', () => {
    expect(isRegisterIntent('signup')).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isRegisterIntent(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRegisterIntent('')).toBe(false);
  });

  it('returns false for unrelated string value', () => {
    expect(isRegisterIntent('login')).toBe(false);
  });

  it('returns false for partial match ("reg")', () => {
    expect(isRegisterIntent('reg')).toBe(false);
  });

  it('returns false for uppercase variant ("REGISTER")', () => {
    expect(isRegisterIntent('REGISTER')).toBe(false);
  });

  it('takes first element when rawIntent is an array with "register"', () => {
    expect(isRegisterIntent(['register', 'other'])).toBe(true);
  });

  it('takes first element when rawIntent is an array with "signup"', () => {
    expect(isRegisterIntent(['signup', 'other'])).toBe(true);
  });

  it('returns false when array first element is not a register intent', () => {
    expect(isRegisterIntent(['login', 'register'])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(isRegisterIntent([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolvePlanBannerName (Wave W3 — plan-aware login banner)
// ---------------------------------------------------------------------------

describe('resolvePlanBannerName', () => {
  it('returns the kernel display name for a paid plan (never the raw enum)', () => {
    // Pro+ is the canonical raw-vs-display divergence (PRO_PLUS → "Pro+").
    expect(resolvePlanBannerName(PricingPlanValue.PRO_PLUS)).toBe(
      getPlanDisplayName(PricingPlanValue.PRO_PLUS)
    );
    expect(resolvePlanBannerName(PricingPlanValue.PRO_PLUS)).toBe('Pro Marka');
    // Must NOT leak the raw enum into copy.
    expect(resolvePlanBannerName(PricingPlanValue.PRO_PLUS)).not.toBe(
      'PRO_PLUS'
    );
  });

  it('returns the display name for PRO', () => {
    expect(resolvePlanBannerName(PricingPlanValue.PRO)).toBe('Pro');
  });

  it('returns null when there is no plan (null) — caller skips the banner', () => {
    expect(resolvePlanBannerName(null)).toBeNull();
  });

  it('returns null when the plan is undefined', () => {
    expect(resolvePlanBannerName(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isFromStylistProfile (S62 — pairing-context login banner)
// ---------------------------------------------------------------------------

describe('isFromStylistProfile', () => {
  it('returns true for a public stylist profile path', () => {
    expect(isFromStylistProfile('/stylist/cmqthyj7e00f658ld3vmohndm')).toBe(
      true
    );
  });

  it('returns true with a trailing slash / query', () => {
    expect(isFromStylistProfile('/stylist/abc123/?from=qr')).toBe(true);
  });

  it('returns true for a locale-prefixed stylist path', () => {
    expect(isFromStylistProfile('/en/stylist/abc123')).toBe(true);
    expect(isFromStylistProfile('/de/stylist/abc123')).toBe(true);
  });

  it('returns false for a non-stylist app path', () => {
    expect(isFromStylistProfile('/app/dashboard')).toBe(false);
  });

  it('returns false for the /for-stylists marketing page (prefix must be exact)', () => {
    expect(isFromStylistProfile('/for-stylists')).toBe(false);
  });

  it('returns false for undefined / empty', () => {
    expect(isFromStylistProfile(undefined)).toBe(false);
    expect(isFromStylistProfile('')).toBe(false);
  });

  it('returns false for open-redirect shapes', () => {
    expect(isFromStylistProfile('//evil.com/stylist/x')).toBe(false);
    expect(isFromStylistProfile('https://evil.com/stylist/x')).toBe(false);
  });

  it('takes the first element of an array', () => {
    expect(isFromStylistProfile(['/stylist/abc', '/other'])).toBe(true);
    expect(isFromStylistProfile(['/app', '/stylist/abc'])).toBe(false);
    expect(isFromStylistProfile([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAuthErrorKey — kody, którymi Better Auth wraca po nieudanym logowaniu
// ---------------------------------------------------------------------------

describe('resolveAuthErrorKey', () => {
  it('rozpoznaje kod z incydentu 2026-08-17 (konto bez podpiętego providera)', () => {
    expect(resolveAuthErrorKey('account_not_linked')).toBe('accountNotLinked');
  });

  it('zbiera kody wygasłego/zerwanego przebiegu w jedną kategorię', () => {
    expect(resolveAuthErrorKey('state_mismatch')).toBe('sessionExpired');
    expect(resolveAuthErrorKey('invalid_code')).toBe('sessionExpired');
    expect(resolveAuthErrorKey('no_code')).toBe('sessionExpired');
    expect(resolveAuthErrorKey('invalid_callback_request')).toBe(
      'sessionExpired'
    );
  });

  it('rozpoznaje rezygnację użytkownika po stronie dostawcy', () => {
    expect(resolveAuthErrorKey('access_denied')).toBe('cancelled');
  });

  it('rozpoznaje wyłączony kanał natywny i wstrzymaną rejestrację', () => {
    expect(resolveAuthErrorKey('native_login_unavailable')).toBe(
      'nativeUnavailable'
    );
    expect(resolveAuthErrorKey('signup_disabled')).toBe('signupDisabled');
  });

  it('nieznany kod schodzi do kategorii ogólnej, nigdy do surowej treści', () => {
    expect(resolveAuthErrorKey('some_new_library_code')).toBe('generic');
    expect(resolveAuthErrorKey('unable_to_create_user')).toBe('generic');
  });

  it('jest odporny na wielkość liter i kształt query', () => {
    expect(resolveAuthErrorKey('ACCOUNT_NOT_LINKED')).toBe('accountNotLinked');
    expect(resolveAuthErrorKey(['state_mismatch', 'x'])).toBe('sessionExpired');
  });

  it('zwraca null, gdy w adresie nie ma błędu', () => {
    expect(resolveAuthErrorKey(undefined)).toBeNull();
    expect(resolveAuthErrorKey('')).toBeNull();
    expect(resolveAuthErrorKey([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isNativeAuthReturn — marker zewnętrznej karty otwartej przez aplikację
// ---------------------------------------------------------------------------

describe('isNativeAuthReturn', () => {
  it('rozpoznaje marker ustawiany przez native-oauth-start', () => {
    expect(isNativeAuthReturn('1')).toBe(true);
    expect(isNativeAuthReturn(['1'])).toBe(true);
  });

  it('nie reaguje na inne wartości ani na brak markera', () => {
    expect(isNativeAuthReturn('0')).toBe(false);
    expect(isNativeAuthReturn('true')).toBe(false);
    expect(isNativeAuthReturn(undefined)).toBe(false);
    expect(isNativeAuthReturn([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// magicLinkSendErrorKey
// ---------------------------------------------------------------------------

describe('magicLinkSendErrorKey', () => {
  it('maps the limiter status to the wait-a-moment copy', () => {
    expect(magicLinkSendErrorKey(429)).toBe('sendRateLimited');
  });

  it('keeps the generic send error for every other refusal', () => {
    expect(magicLinkSendErrorKey(400)).toBe('sendError');
    expect(magicLinkSendErrorKey(500)).toBe('sendError');
    expect(magicLinkSendErrorKey(undefined)).toBe('sendError');
  });
});
