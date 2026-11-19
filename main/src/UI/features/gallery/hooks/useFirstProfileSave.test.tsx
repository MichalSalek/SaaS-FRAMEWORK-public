import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFirstProfileSave } from './useFirstProfileSave';

const state = vi.hoisted(() => ({ update: vi.fn(), name: vi.fn() }));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  changeDisplayName_IO: state.name,
  updateStylistProfile_IO: state.update,
}));
vi.mock('../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: {
      stylist_account: {
        display_name: 'Anna',
        address_city: 'Berlin',
        address_country: null,
        address_street: null,
        address_postal_code: null,
        business_name: null,
        phone: null,
        website: null,
        description: null,
        email_preferences: null,
      },
    },
  }),
}));
vi.mock('../../shared/gallery/hooks/useTogglePin', () => ({
  useTogglePin: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../shared/email/hooks/useUpdateEmailPreferences', () => ({
  useUpdateEmailPreferences: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../shared/profile/invalidate-stylist-profile.helper', () => ({
  invalidateStylistProfileCaches: vi.fn(),
}));
vi.mock('../../../../application/analytics/flow-events', () => ({
  trackFlowStep: vi.fn(),
}));

describe('first profile country', () => {
  it('saves the selected country even when the existing city did not change', async () => {
    state.update.mockReset();
    state.update.mockResolvedValue({});
    const client = new QueryClient();
    const view = renderHook(() => useFirstProfileSave('photo'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(async () =>
      view.result.current.save({
        displayName: 'Anna',
        city: 'Berlin',
        country: 'DE',
        pinPhoto: false,
        marketing: false,
      })
    );
    expect(state.update).toHaveBeenCalledWith({
      location: expect.objectContaining({
        address_city: 'Berlin',
        address_country: 'DE',
      }),
    });
    expect(view.result.current.status).toBe('saved');
  });
});
