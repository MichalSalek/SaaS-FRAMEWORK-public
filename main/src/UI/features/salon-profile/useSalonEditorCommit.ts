import { useEffect, useRef, useState } from 'react';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import {
  decideSlugCommit,
  normalizeSalonContact,
  savedDraft,
  type SalonDraft,
  type SalonUpdateRequest,
} from './salonProfileDraft';

type Box = 'identity' | 'location' | 'contact' | 'colour' | 'team' | 'works';

type Flight = {
  isBusy: (section: 'salon') => boolean;
  discard: (section: 'salon') => void;
  save: (section: 'salon', request: SalonUpdateRequest) => void;
};

function removeRevertedPatch(
  pending: SalonUpdateRequest,
  reverted: SalonUpdateRequest
): SalonUpdateRequest {
  const remaining = { ...pending };
  for (const key of Object.keys(reverted) as Array<keyof SalonUpdateRequest>) {
    if (key === 'contact') {
      const contact = { ...remaining.contact };
      for (const field of Object.keys(reverted.contact ?? {}) as Array<
        keyof NonNullable<SalonUpdateRequest['contact']>
      >) {
        delete contact[field];
      }
      if (Object.keys(contact).length === 0) {
        delete remaining.contact;
      } else {
        remaining.contact = contact;
      }
    } else {
      delete remaining[key];
    }
  }
  return remaining;
}

/** One snapshot per blur. A street without a city stays on screen and is not sent. */
export function useSalonEditorCommit({
  savedRef,
  committedSlugRef,
  rememberSlug,
  draftRef,
  slug,
  slugValid,
  slugState,
  saves,
  setSavingBox,
  pendingPatchesRef,
}: {
  savedRef: { current: SalonProfileData };
  committedSlugRef: { current: string };
  rememberSlug: (value: string) => void;
  draftRef: { current: SalonDraft };
  slug: string;
  slugValid: boolean;
  slugState: 'checking' | 'available' | 'taken' | 'error';
  saves: Flight;
  setSavingBox: (box: Box) => void;
  pendingPatchesRef: { current: SalonUpdateRequest };
}) {
  const lastCommit = useRef<{ box: Box; slugOnly: boolean } | null>(null);
  const commit = (
    box: Box,
    patch: Partial<SalonDraft> = {},
    slugOnly = false
  ) => {
    const next = { ...draftRef.current, ...patch };
    const invalidLocation =
      next.contact.address_street.trim() !== '' &&
      next.contact.address_city.trim() === '';
    if (box === 'location' && invalidLocation) {
      return;
    }
    const contact = normalizeSalonContact(next.contact);
    const saved = savedDraft(savedRef.current);
    const savedContact = normalizeSalonContact(saved.contact);
    let request: SalonUpdateRequest;
    let baseline: SalonUpdateRequest;
    if (box === 'identity') {
      if (slugOnly) {
        request = { salon_vanity_url: next.slug || null };
        baseline = {
          salon_vanity_url: savedRef.current.salon_vanity_url ?? null,
        };
      } else {
        if (!next.name.trim()) {
          return;
        }
        request = { name: next.name.trim() };
        baseline = { name: saved.name.trim() };
      }
    } else if (box === 'location') {
      const { address_country, address_city, address_street } = contact;
      request = { contact: { address_country, address_city, address_street } };
      baseline = {
        contact: {
          address_country: savedContact.address_country,
          address_city: savedContact.address_city,
          address_street: savedContact.address_street,
        },
      };
    } else if (box === 'contact') {
      const { phone, website, instagram_handle, external_links } = contact;
      request = {
        contact: { phone, website, instagram_handle, external_links },
      };
      baseline = {
        contact: {
          phone: savedContact.phone,
          website: savedContact.website,
          instagram_handle: savedContact.instagram_handle,
          external_links: savedContact.external_links,
        },
      };
    } else if (box === 'colour') {
      request = { brand_accent_color: next.accent };
      baseline = { brand_accent_color: saved.accent };
    } else if (box === 'team') {
      request = { show_team: next.showTeam };
      baseline = { show_team: saved.showTeam };
    } else {
      request = { pinned_record_ids: next.pins };
      baseline = { pinned_record_ids: saved.pins };
    }
    if (
      JSON.stringify(request) === JSON.stringify(baseline) &&
      !saves.isBusy('salon')
    ) {
      pendingPatchesRef.current = removeRevertedPatch(
        pendingPatchesRef.current,
        request
      );
      if (Object.keys(pendingPatchesRef.current).length === 0) {
        saves.discard('salon');
      }
      return;
    }
    const pending = pendingPatchesRef.current;
    const combined = {
      ...pending,
      ...request,
      ...(pending.contact || request.contact
        ? { contact: { ...pending.contact, ...request.contact } }
        : {}),
    };
    pendingPatchesRef.current = combined;
    lastCommit.current = { box, slugOnly };
    setSavingBox(box);
    saves.save('salon', combined);
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;
  const [slugWaiting, setSlugWaiting] = useState(false);
  const leaveSlug = () => {
    const decision = decideSlugCommit({
      slug,
      savedSlug: committedSlugRef.current,
      valid: slugValid,
      availability: slugState,
    });
    setSlugWaiting(decision === 'wait');
    if (decision === 'save') {
      rememberSlug(slug);
      commit('identity', {}, true);
    }
  };
  useEffect(() => {
    if (!slugWaiting || slugState === 'checking') {
      return;
    }
    setSlugWaiting(false);
    if (slugState === 'available' && slugValid) {
      rememberSlug(draftRef.current.slug);
      commitRef.current('identity', {}, true);
    }
  }, [slugWaiting, slugState, slugValid, rememberSlug, draftRef]);

  const retry = () => {
    if (lastCommit.current) {
      commit(lastCommit.current.box, {}, lastCommit.current.slugOnly);
      if (
        !saves.isBusy('salon') &&
        Object.keys(pendingPatchesRef.current).length > 0
      ) {
        saves.save('salon', pendingPatchesRef.current);
      }
    }
  };
  return { commit, leaveSlug, retry };
}
