import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type * as ReactQuery from '@tanstack/react-query';
import { useStylistSalonScope } from './useStylistSalonScope';

const data = vi.hoisted(() => ({
  salons: [] as {
    account_id: string;
    name: string;
    members: { account_id: string }[];
  }[],
  publicSalon: null as { account_id: string; name: string } | null,
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof ReactQuery>()),
  useQuery: () => ({
    data: {
      salon_link: data.publicSalon,
      account: { display_name: 'Colleague' },
    },
  }),
}));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  getPublicProfile_IO: vi.fn(),
}));
vi.mock('../../shared/pairing/hooks/usePairedList', () => ({
  usePairedList: () => ({ data: { pages: [{ salons: data.salons }] } }),
}));
vi.mock('../../../shared/hooks/useUrlSyncedState', () => ({
  useUrlSyncedState: () => ['salon', vi.fn()],
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale='pl' messages={{}} onError={() => {}}>
    {children}
  </NextIntlClientProvider>
);

describe('salon gallery access source', () => {
  it('recognizes a salon connection for a colleague without an individual pair', () => {
    data.salons = [
      {
        account_id: 'salon',
        name: 'Salon',
        members: [{ account_id: 'colleague' }],
      },
    ];
    data.publicSalon = null;
    const { result } = renderHook(() => useStylistSalonScope('colleague'), {
      wrapper,
    });
    expect(result.current.salon?.account_id).toBe('salon');
    expect(result.current.hasSalonAccess).toBe(true);
  });
  it('does not turn a public salon link into authenticated access', () => {
    data.salons = [];
    data.publicSalon = { account_id: 'salon', name: 'Salon' };
    const { result } = renderHook(() => useStylistSalonScope('colleague'), {
      wrapper,
    });
    expect(result.current.salon?.account_id).toBe('salon');
    expect(result.current.hasSalonAccess).toBe(false);
  });
});
