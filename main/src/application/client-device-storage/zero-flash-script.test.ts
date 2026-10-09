import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  ZERO_FLASH_SCRIPT,
  ZERO_FLASH_SCRIPT_CSP_HASH,
} from './zero-flash-script';

// Drift guard: proxy.ts allows the ZERO_FLASH inline script on prod-mode (SSG)
// pages via a PINNED sha256 hash (Edge runtime can't compute it at request time).
// If ZERO_FLASH_SCRIPT changes and the pinned hash isn't updated, the inline
// theme bridge gets CSP-blocked (FOUC returns). This test fails on that drift and
// prints the correct value to paste into ZERO_FLASH_SCRIPT_CSP_HASH.
describe('ZERO_FLASH_SCRIPT CSP hash', () => {
  it('pinned hash matches sha256 of the rendered inline script', () => {
    const digest = createHash('sha256')
      .update(ZERO_FLASH_SCRIPT, 'utf8')
      .digest('base64');
    expect(ZERO_FLASH_SCRIPT_CSP_HASH).toBe(`'sha256-${digest}'`);
  });

  // Drift guard for the native-entry redirect targets. The pre-paint bridge
  // HARDCODES '/app' and '/welcome' (lean module — it cannot import the routing
  // SSOT into the Edge bundle). If ROUTES_FRONT.APP/WELCOME are ever renamed, the
  // guard picks up the constant while this inline script silently redirects to a
  // stale/404 path in the wrapper. Pin the coupling here so a rename fails loudly.
  it('inline native-entry redirect targets stay in sync with the routing SSOT', () => {
    expect(ZERO_FLASH_SCRIPT).toContain(`'${ROUTES_FRONT.APP}'`);
    expect(ZERO_FLASH_SCRIPT).toContain(`'${ROUTES_FRONT.WELCOME}'`);
  });
});
