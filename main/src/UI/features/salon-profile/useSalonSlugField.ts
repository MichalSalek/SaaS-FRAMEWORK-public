import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { getSalonProfilePath } from '@kernel/domain/salon-profile/salon.urls';
import { vanityUrlSchema } from '@kernel/domain/user-and-account/vanity-url.config';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { checkSalonSlug_IO } from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import type { SlugAvailability } from './salonProfileDraft';

/** The salon's own link while it is typed: rules, availability (debounced),
 *  the full address it makes and the line said under the field. */
export function useSalonSlugField(
  slug: string,
  savedSlug: string | null,
  profile: SalonProfileData
) {
  const t = useTranslations('salon.profile');
  const [debouncedSlug, setDebouncedSlug] = useState(slug);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSlug(slug), 350);
    return () => clearTimeout(timer);
  }, [slug]);
  const validSlug = vanityUrlSchema.safeParse(slug).success;
  const availability = useQuery({
    queryKey: queryKeys.salon.slugAvailability(debouncedSlug),
    queryFn: ({ signal }) =>
      checkSalonSlug_IO({ slug: debouncedSlug }, { signal }),
    enabled: validSlug && debouncedSlug === slug,
  });
  const isSaved = slug === savedSlug;
  // The saved link stands in the link card above; repeating it said nothing.
  const preview =
    isSaved || !validSlug
      ? null
      : `${
          typeof window !== 'undefined'
            ? window.location.host
            : BRAND_CONFIG.domain
        }${getSalonProfilePath({
          ...profile,
          salon_vanity_url: slug || null,
        }).replace(/\/$/, '')}`;
  const message = !validSlug
    ? t('slugRules')
    : isSaved
      ? ''
      : availability.isError
        ? t('loadError')
        : availability.isFetching || debouncedSlug !== slug
          ? t('slugChecking')
          : availability.data?.available
            ? t('slugAvailable')
            : t('slugTaken');
  const state: SlugAvailability = availability.isError
    ? 'error'
    : availability.isFetching || debouncedSlug !== slug || !availability.data
      ? 'checking'
      : availability.data.available
        ? 'available'
        : 'taken';
  // Rules broken or the link taken: said as the field's error, not a hint.
  const isError = !validSlug || (!isSaved && state === 'taken');
  return { validSlug, state, preview, message, isError };
}
