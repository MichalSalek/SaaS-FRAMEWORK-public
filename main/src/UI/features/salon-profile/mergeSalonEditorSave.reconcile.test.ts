import { describe, expect, it } from 'vitest';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { initialDraft } from './salonProfileDraft';
import {
  handleFailedSalonSave,
  reconcileSalonDraft,
} from './mergeSalonEditorSave';
import { QueryClient } from '@tanstack/react-query';
const owner = {
  account_id: 'owner',
  name: 'Owner',
  avatar_url: null,
  identifier: 'owner',
};
const before: SalonProfileData = {
  account_id: 'owner',
  name: 'Old name',
  salon_vanity_url: 'old',
  brand_accent_color: null,
  show_team: true,
  owner,
  members: [],
  works: [],
  contact: {
    address_city: 'Warsaw',
    address_street: null,
    address_country: 'PL',
    website: null,
    instagram_handle: null,
    phone: null,
  },
};
describe('salon response reconciliation', () => {
  it('keeps a queued slug when a different in-flight box fails', () => {
    const committedSlug = { current: 'new' };
    const pending = { salon_vanity_url: 'new' };
    handleFailedSalonSave(
      new Error('offline'),
      { show_team: false },
      pending,
      before,
      committedSlug,
      new QueryClient()
    );
    expect(committedSlug.current).toBe('new');
  });
  it('adopts external untouched fields while preserving typed, in-flight and queued edits', () => {
    const draft = initialDraft(before);
    draft.contact.phone = 'unblurred phone';
    draft.showTeam = false;
    draft.accent = '#aa0044';
    const after: SalonProfileData = {
      ...before,
      name: 'New name',
      salon_vanity_url: 'new',
      show_team: false,
      contact: {
        ...before.contact,
        address_city: 'Kraków',
        phone: 'external phone',
      },
    };
    const next = reconcileSalonDraft(
      draft,
      before,
      after,
      { show_team: false },
      { brand_accent_color: '#aa0044' }
    );
    expect(next.name).toBe('New name');
    expect(next.slug).toBe('new');
    expect(next.contact.address_city).toBe('Kraków');
    expect(next.contact.phone).toBe('unblurred phone');
    expect(next.showTeam).toBe(false);
    expect(next.accent).toBe('#aa0044');
  });
  it('does not replace an intentional revert while a conflicting value is in flight', () => {
    const draft = initialDraft(before);
    const after = { ...before, name: 'in-flight value' };
    expect(
      reconcileSalonDraft(draft, before, after, { name: 'in-flight value' }, {})
        .name
    ).toBe('Old name');
  });
});
