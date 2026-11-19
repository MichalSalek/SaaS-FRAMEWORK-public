import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import {
  initialDraft,
  type SalonDraft,
  type SalonUpdateRequest,
} from './salonProfileDraft';
import type { Dispatch, SetStateAction } from 'react';
import {
  traceSalonProfileFailed,
  traceSalonProfileSaved,
} from './salonProfileFlowTrace';
import { updateSalonProfile_IO } from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { invalidateStylistProfileCaches } from '../shared/profile/invalidate-stylist-profile.helper';

export function handleFailedSalonSave(
  error: unknown,
  request: SalonUpdateRequest,
  pending: SalonUpdateRequest,
  saved: SalonProfileData,
  committedSlug: { current: string },
  cache: QueryClient
): void {
  const failedSlug = request.salon_vanity_url;
  const hasQueuedSlug = pending.salon_vanity_url !== undefined;
  retainFailedSalonPatch(pending, request);
  traceSalonProfileFailed(error);
  const stored = saved.salon_vanity_url ?? '';
  if (
    failedSlug !== undefined &&
    !hasQueuedSlug &&
    committedSlug.current === (failedSlug ?? '') &&
    committedSlug.current !== stored
  ) {
    committedSlug.current = stored;
    void cache.invalidateQueries({
      queryKey: queryKeys.salon.slugAvailability(
        request.salon_vanity_url ?? ''
      ),
    });
  }
}

type Setter<T> = Dispatch<SetStateAction<T>>;
type DraftSetters = [
  Setter<string>,
  Setter<string>,
  Setter<SalonDraft['contact']>,
  Setter<string | null>,
  Setter<boolean>,
  Setter<string[]>,
  (
    expected: SalonDraft['contact']['address_country'],
    next: SalonDraft['contact']['address_country']
  ) => void,
];

export async function saveSalonEditor(
  request: SalonUpdateRequest,
  context: {
    pending: { current: SalonUpdateRequest };
    draft: { current: SalonDraft };
    saved: { current: SalonProfileData };
    committedSlug: { current: string };
    setSaved: Setter<SalonProfileData>;
    setters: DraftSetters;
    cache: QueryClient;
  }
): Promise<SalonProfileData> {
  context.pending.current = {};
  try {
    const response = await updateSalonProfile_IO(request, {
      successFeedback: 'screen',
    });
    reconcileSalonResponse(
      context.draft.current,
      context.saved.current,
      response,
      request,
      context.pending.current,
      context.committedSlug,
      context.setters
    );
    context.saved.current = response;
    context.setSaved(response);
    applySalonEditorSave(context.cache, response);
    invalidateStylistProfileCaches(context.cache);
    traceSalonProfileSaved(response.works.length, response.show_team);
    return response;
  } catch (error) {
    handleFailedSalonSave(
      error,
      request,
      context.pending.current,
      context.saved.current,
      context.committedSlug,
      context.cache
    );
    throw error;
  }
}
export function reconcileSalonResponse(
  observed: SalonDraft,
  saved: SalonProfileData,
  response: SalonProfileData,
  sent: SalonUpdateRequest,
  pending: SalonUpdateRequest,
  committedSlug: { current: string },
  setters: DraftSetters
): void {
  const reconciled = reconcileSalonDraft(
    observed,
    saved,
    response,
    sent,
    pending
  );
  const [name, slug, contact, accent, showTeam, pins, country] = setters;
  applySalonDraftReconciliation(observed, reconciled, {
    name,
    slug,
    contact,
    accent,
    showTeam,
    pins,
    country,
  });
  if (
    committedSlug.current === observed.slug &&
    reconciled.slug !== observed.slug
  ) {
    committedSlug.current = reconciled.slug;
  }
}
export function applySalonDraftReconciliation(
  observed: SalonDraft,
  next: SalonDraft,
  setters: {
    name: Setter<string>;
    slug: Setter<string>;
    contact: Setter<SalonDraft['contact']>;
    accent: Setter<string | null>;
    showTeam: Setter<boolean>;
    pins: Setter<string[]>;
    country: (
      expected: SalonDraft['contact']['address_country'],
      next: SalonDraft['contact']['address_country']
    ) => void;
  }
): void {
  setters.name(current => (current === observed.name ? next.name : current));
  setters.slug(current => (current === observed.slug ? next.slug : current));
  setters.accent(current =>
    current === observed.accent ? next.accent : current
  );
  setters.showTeam(current =>
    current === observed.showTeam ? next.showTeam : current
  );
  setters.pins(current => (current === observed.pins ? next.pins : current));
  setters.country(
    observed.contact.address_country,
    next.contact.address_country
  );
  setters.contact(current => {
    const updated = { ...current };
    for (const key of [
      'address_city',
      'address_street',
      'website',
      'instagram_handle',
      'phone',
    ] as const) {
      if (current[key] === observed.contact[key]) {
        updated[key] = next.contact[key];
      }
    }
    return updated;
  });
}

/** Adopt fresh server values only for fields untouched since the previous baseline. */
export function reconcileSalonDraft(
  draft: SalonDraft,
  previous: SalonProfileData,
  response: SalonProfileData,
  sent: SalonUpdateRequest,
  queued: SalonUpdateRequest
): SalonDraft {
  const before = initialDraft(previous);
  const after = initialDraft(response);
  const field = <T>(current: T, old: T, fresh: T, owned: boolean): T =>
    !owned && current === old ? fresh : current;
  const owned = (key: keyof SalonUpdateRequest) =>
    sent[key] !== undefined || queued[key] !== undefined;
  const contactOwned = (key: keyof SalonDraft['contact']) =>
    sent.contact?.[key] !== undefined || queued.contact?.[key] !== undefined;
  const contact = { ...draft.contact };
  for (const key of [
    'address_country',
    'address_city',
    'address_street',
    'website',
    'instagram_handle',
    'phone',
  ] as const) {
    // All non-country fields are strings; the country field retains its narrowed type.
    if (!contactOwned(key) && draft.contact[key] === before.contact[key]) {
      Object.assign(contact, { [key]: after.contact[key] });
    }
  }
  return {
    name: field(draft.name, before.name, after.name, owned('name')),
    slug: field(draft.slug, before.slug, after.slug, owned('salon_vanity_url')),
    accent: field(
      draft.accent,
      before.accent,
      after.accent,
      owned('brand_accent_color')
    ),
    showTeam: field(
      draft.showTeam,
      before.showTeam,
      after.showTeam,
      owned('show_team')
    ),
    pins:
      !owned('pinned_record_ids') &&
      JSON.stringify(draft.pins) === JSON.stringify(before.pins)
        ? after.pins
        : draft.pins,
    contact,
  };
}

export function retainFailedSalonPatch(
  pending: SalonUpdateRequest,
  failed: SalonUpdateRequest
): void {
  const merged = {
    ...failed,
    ...pending,
    ...(failed.contact || pending.contact
      ? { contact: { ...failed.contact, ...pending.contact } }
      : {}),
  };
  Object.assign(pending, merged);
}

// Only the fields submitted by this form: logo, roster and visibility can
// change independently while the full server response is in flight.
function mergeSalonEditorSave(
  current: SalonProfileData | undefined,
  response: SalonProfileData
): SalonProfileData | undefined {
  if (current?.account_id !== response.account_id) {
    return current;
  }
  return {
    ...current,
    name: response.name,
    ...(response.name_configured !== undefined && {
      name_configured: response.name_configured,
    }),
    ...(response.salon_vanity_url !== undefined && {
      salon_vanity_url: response.salon_vanity_url,
    }),
    brand_accent_color: response.brand_accent_color,
    show_team: response.show_team,
    works: response.works,
    contact: response.contact,
  };
}

export function applySalonEditorSave(
  cache: QueryClient,
  response: SalonProfileData
): void {
  cache.setQueryData<SalonProfileData>(queryKeys.salon.mine, current =>
    mergeSalonEditorSave(current, response)
  );
}
