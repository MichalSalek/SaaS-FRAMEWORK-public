import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SafeStylistAccountWire } from '@kernel/domain/user/user.contract-schemas';
const st = vi.hoisted(() => ({ mutate: vi.fn(async () => undefined) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({
      isPending: false,
      error: null,
      data: { user: { id: 'user-a' } },
    }),
  },
}));
vi.mock('./hooks/useUpdateStylistProfile', () => ({
  useUpdateStylistProfile: () => ({ mutateAsync: st.mutate, isPending: false }),
}));
vi.mock('../../../shared/hooks/useLeaveGuard', () => ({
  useLeaveGuard: () => {},
}));
vi.mock('../../../../application/routing/leave-guard', () => ({
  isLeaveBypassed: () => false,
}));
vi.mock('./StylistBioField.molecule', () => ({
  StylistBioFieldMolecule: ({
    value,
    onChange,
    onBlur,
  }: {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
  }) => (
    <textarea
      aria-label='bio'
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
    />
  ),
}));
vi.mock('./ProfileSaveLine.molecule', () => ({
  ProfileSaveLineMolecule: () => null,
}));
vi.mock('../../../components/AppParagraphLink/AppParagraphLink.atom', () => ({
  AppParagraphLinkAtom: () => null,
}));
vi.mock('../../../components/Button/Button.atom', () => ({
  ButtonAtom: () => null,
}));
import { bindDocumentCredentials } from '../../../../application/auth/document-credentials';
import { callHTTPEndpoint } from '../../../../application/http/http.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { PublicBioEditorOrganism } from './PublicBioEditor.organism';
describe('cross-tab bearer change', () => {
  it('never sends the previous user draft after the stored bearer changes', async () => {
    localStorage.clear();
    localStorage.setItem('authorization', 'token-a');
    bindDocumentCredentials();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    st.mutate.mockImplementation(
      async () =>
        new Promise((resolve, reject) => {
          void callHTTPEndpoint({
            config: {
              url: () => 'http://example.invalid/private',
              mode: 'post',
            },
            successCallback: async () => resolve(undefined),
            errorCallback: async e => reject(e),
          });
        })
    );
    const client = new QueryClient();
    const account = {
      account_id: 'account-a',
      description: 'old',
      vanity_url: null,
    };
    client.setQueryData(queryKeys.account.current, {
      id: 'user-a',
      stylist_account: account,
    });
    render(
      <QueryClientProvider client={client}>
        <PublicBioEditorOrganism
          stylistAccount={account as unknown as SafeStylistAccountWire}
        />
      </QueryClientProvider>
    );
    fireEvent.change(screen.getByLabelText('bio'), {
      target: { value: 'private-a' },
    });
    localStorage.setItem('authorization', 'token-b');
    fireEvent.blur(screen.getByLabelText('bio'));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(st.mutate).toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(localStorage.getItem('authorization')).toBe('token-b');
  });
});
