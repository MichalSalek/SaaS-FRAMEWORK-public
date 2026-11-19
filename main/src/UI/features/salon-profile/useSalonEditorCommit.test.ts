import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { salonProfileUpdateSchema } from '@kernel/domain/salon-profile/salon-profile.contract-schemas';
import { initialDraft, type SalonUpdateRequest } from './salonProfileDraft';
import { useSalonEditorCommit } from './useSalonEditorCommit';
import { useSingleFlightSaves } from '../shared/profile/hooks/useSingleFlightSaves';
import { useRef } from 'react';
import { waitFor } from '@testing-library/react';

const profile: SalonProfileData = {
  account_id: 'owner',
  name: 'Salon Testowy',
  name_configured: true,
  salon_vanity_url: 'salon-testowy',
  suggested_slug: null,
  brand_accent_color: null,
  show_team: true,
  owner: {
    account_id: 'owner',
    name: 'Anna',
    avatar_url: null,
    identifier: 'owner',
  },
  members: [],
  works: [],
  contact: {
    address_city: null,
    address_street: null,
    website: null,
    instagram_handle: null,
    phone: null,
  },
};

function harness() {
  const draftRef = { current: initialDraft(profile) };
  const requests: SalonUpdateRequest[] = [];
  const save = vi.fn((_section: 'salon', request: SalonUpdateRequest) => {
    requests.push(request);
  });
  const hook = renderHook(() =>
    useSalonEditorCommit({
      savedRef: { current: profile },
      committedSlugRef: { current: 'salon-testowy' },
      rememberSlug: vi.fn(),
      draftRef,
      slug: 'salon-testowy',
      slugValid: true,
      slugState: 'available',
      saves: { isBusy: () => requests.length > 0, discard: vi.fn(), save },
      setSavingBox: vi.fn(),
      pendingPatchesRef: { current: {} },
    })
  );
  return { hook, draftRef, requests, save };
}

describe('independent salon contact save', () => {
  it('does not resurrect a failed name after the user reverts it', () => {
    const draftRef = { current: initialDraft(profile) };
    const pendingPatchesRef = {
      current: { name: 'failed name' } as SalonUpdateRequest,
    };
    const save = vi.fn();
    const discard = vi.fn();
    const hook = renderHook(() =>
      useSalonEditorCommit({
        savedRef: { current: profile },
        committedSlugRef: { current: 'salon-testowy' },
        rememberSlug: vi.fn(),
        draftRef,
        slug: 'salon-testowy',
        slugValid: true,
        slugState: 'available',
        saves: { isBusy: () => false, discard, save },
        setSavingBox: vi.fn(),
        pendingPatchesRef,
      })
    );
    act(() => hook.result.current.commit('identity'));
    draftRef.current.showTeam = false;
    act(() => hook.result.current.commit('team'));
    expect(save).toHaveBeenCalledWith('salon', { show_team: false });
  });
  it('removes only reverted contact keys while retaining an earlier committed location', () => {
    const draftRef = { current: initialDraft(profile) };
    const pendingPatchesRef = {
      current: {
        contact: { phone: 'failed phone', address_city: 'Kraków' },
      } as SalonUpdateRequest,
    };
    const save = vi.fn();
    const discard = vi.fn();
    const hook = renderHook(() =>
      useSalonEditorCommit({
        savedRef: { current: profile },
        committedSlugRef: { current: 'salon-testowy' },
        rememberSlug: vi.fn(),
        draftRef,
        slug: 'salon-testowy',
        slugValid: true,
        slugState: 'available',
        saves: { isBusy: () => false, discard, save },
        setSavingBox: vi.fn(),
        pendingPatchesRef,
      })
    );
    act(() => hook.result.current.commit('contact'));
    expect(pendingPatchesRef.current).toEqual({
      contact: { address_city: 'Kraków' },
    });
    expect(discard).not.toHaveBeenCalled();
    draftRef.current.showTeam = false;
    act(() => hook.result.current.commit('team'));
    expect(save).toHaveBeenCalledWith('salon', {
      contact: { address_city: 'Kraków' },
      show_team: false,
    });
  });
  it('allows an explicit retry of other failed boxes after one box is reverted', () => {
    const draftRef = { current: initialDraft(profile) };
    const pendingPatchesRef = {
      current: { contact: { address_city: 'Kraków' } } as SalonUpdateRequest,
    };
    const save = vi.fn();
    const hook = renderHook(() =>
      useSalonEditorCommit({
        savedRef: { current: profile },
        committedSlugRef: { current: 'salon-testowy' },
        rememberSlug: vi.fn(),
        draftRef,
        slug: 'salon-testowy',
        slugValid: true,
        slugState: 'available',
        saves: { isBusy: () => false, discard: vi.fn(), save },
        setSavingBox: vi.fn(),
        pendingPatchesRef,
      })
    );
    draftRef.current.name = 'failed name';
    act(() => hook.result.current.commit('identity'));
    draftRef.current.name = profile.name;
    act(() => hook.result.current.commit('identity'));
    save.mockClear();
    act(() => hook.result.current.retry());
    expect(save).toHaveBeenCalledWith('salon', {
      contact: { address_city: 'Kraków' },
    });
  });
  it('merges unsent boxes while a save is in flight', async () => {
    const requests: SalonUpdateRequest[] = [];
    let release!: () => void;
    const draftRef = { current: initialDraft(profile) };
    const hook = renderHook(() => {
      const pendingPatchesRef = useRef<SalonUpdateRequest>({});
      const saves = useSingleFlightSaves<'salon', SalonUpdateRequest>(
        async request => {
          pendingPatchesRef.current = {};
          requests.push(request);
          if (requests.length === 1) {
            await new Promise<void>(resolve => {
              release = resolve;
            });
          }
        }
      );
      return useSalonEditorCommit({
        savedRef: { current: profile },
        committedSlugRef: { current: 'salon-testowy' },
        rememberSlug: vi.fn(),
        draftRef,
        slug: 'salon-testowy',
        slugValid: true,
        slugState: 'available',
        saves,
        setSavingBox: vi.fn(),
        pendingPatchesRef,
      });
    });
    draftRef.current.showTeam = false;
    act(() => hook.result.current.commit('team'));
    await waitFor(() => expect(requests).toHaveLength(1));
    draftRef.current.contact.phone = '+48123456789';
    act(() => hook.result.current.commit('contact'));
    draftRef.current.accent = '#aa0044';
    act(() => hook.result.current.commit('colour'));
    expect(requests[0]).toEqual({ show_team: false });
    await act(async () => release());
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual({
      contact: {
        phone: '+48123456789',
        website: null,
        instagram_handle: null,
        external_links: [],
      },
      brand_accent_color: '#aa0044',
    });
  });
  it('sends only the committed box, leaving unblurred text and pins out', () => {
    const h = harness();
    h.draftRef.current.name = 'Uncommitted';
    h.draftRef.current.contact.phone = 'Uncommitted';
    h.draftRef.current.pins = ['uncommitted'];
    h.draftRef.current.showTeam = false;
    act(() => h.hook.result.current.commit('team'));
    expect(h.requests[0]).toEqual({ show_team: false });
  });
  it('sends country with the address and retains it when another field saves', () => {
    const h = harness();
    h.draftRef.current.contact.address_city = 'Berlin';
    h.draftRef.current.contact.address_country = 'DE';
    act(() => h.hook.result.current.commit('location'));
    h.draftRef.current.contact.phone = '+49 123456';
    act(() => h.hook.result.current.commit('contact'));
    expect(h.requests[0]?.contact).toMatchObject({
      address_city: 'Berlin',
      address_country: 'DE',
    });
    expect(h.requests[1]?.contact).toMatchObject({
      address_city: 'Berlin',
      address_country: 'DE',
    });
  });

  it('saves a phone while an unfinished street stays visible and unsaved', () => {
    const h = harness();
    h.draftRef.current.contact.address_street = 'Długa 12';
    act(() => h.hook.result.current.commit('location'));
    expect(h.save).not.toHaveBeenCalled();
    h.draftRef.current.contact.phone = '+48 500 100 200';
    act(() => h.hook.result.current.commit('contact'));
    expect(h.requests[0]?.contact).toMatchObject({
      phone: '+48 500 100 200',
    });
    expect(salonProfileUpdateSchema.safeParse(h.requests[0]).success).toBe(
      true
    );
    expect(h.draftRef.current.contact.address_street).toBe('Długa 12');
  });
  it('retains the last valid queued location when a later draft is incomplete', () => {
    const h = harness();
    h.draftRef.current.contact.address_city = 'Kraków';
    h.draftRef.current.contact.address_street = 'Długa 12';
    act(() => h.hook.result.current.commit('location'));
    h.draftRef.current.contact.address_city = '';
    h.draftRef.current.contact.phone = '+48 500 100 200';
    act(() => h.hook.result.current.commit('contact'));
    expect(h.requests[1]?.contact).toMatchObject({
      address_city: 'Kraków',
      address_street: 'Długa 12',
      phone: '+48 500 100 200',
    });
    expect(salonProfileUpdateSchema.safeParse(h.requests[1]).success).toBe(
      true
    );
    expect(h.draftRef.current.contact.address_city).toBe('');
  });
});
