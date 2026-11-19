import { describe, it, expect, vi } from 'vitest';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';

const state = vi.hoisted(() => ({ trusted: false }));
vi.mock('../security/trusted-interaction', () => ({
  hasTrustedInteraction: () => state.trusted,
}));
import { loadEventsMessages } from './events-messages';

describe('lazy event contact messages', () => {
  it('keeps cached source encoded and resolves current trusted state on every read', async () => {
    for (const locale of ['pl', 'en', 'de']) {
      state.trusted = false;
      const hidden = await loadEventsMessages(locale);
      expect(hidden.ACCOUNT_RECOVERY_FAILED).not.toContain(
        BRAND_CONFIG.email.support
      );
      expect(hidden.ACCOUNT_RECOVERY_FAILED).not.toContain('__NF_CONTACT_');
      state.trusted = true;
      const visible = await loadEventsMessages(locale);
      expect(visible.ACCOUNT_RECOVERY_FAILED).toContain(
        BRAND_CONFIG.email.support
      );
      expect(visible.ACCOUNT_RECOVERY_FAILED).not.toContain('__NF_CONTACT_');
    }
  });
});
