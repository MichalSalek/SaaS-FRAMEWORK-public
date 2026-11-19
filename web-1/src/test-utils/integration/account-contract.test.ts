/**
 * Account handlers bound through `defineEndpoint(contract)`.
 * Pins a command 400 and the public-profile required-id literal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import changeName from '../../pages/api/v1/account/display-name-change/index';
import publicProfile from '../../pages/api/v1/public/get-stylist-profile/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

vi.mock('@domain/account/operations/account-profile.operations', () => ({
  getPublicStylistProfile_IO: vi.fn(),
  incrementProfileView_IO: vi.fn(),
}));

vi.mock('@domain/account/operations/account-settings.operations', () => ({
  accountUpdateDisplayName_IO: vi.fn(),
}));

describe('account through the API contract', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
  });

  it('display name: a missing name is 400 and never reaches the operation', async () => {
    const { accountUpdateDisplayName_IO } =
      await import('@domain/account/operations/account-settings.operations');
    const { status, event, data } = await mockApiHandler<{
      display_name?: string;
    }>(changeName, { method: 'POST', body: {} });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(data.display_name).toContain('validation.displayName.');
    expect(accountUpdateDisplayName_IO).not.toHaveBeenCalled();
  });

  it('public profile: a missing identifier stays the literal Required', async () => {
    for (const query of [{}, { identifier: '' }, { identifier: ['a', 'b'] }]) {
      const { status, event, data } = await mockApiHandler(publicProfile, {
        method: 'GET',
        query: { ...query },
      });
      expect(status).toBe(400);
      expect(event).toBe('VALIDATION_FAILED');
      expect(data).toEqual({ identifier: 'Required' });
    }
  });
});
