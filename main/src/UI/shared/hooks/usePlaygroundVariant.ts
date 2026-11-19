import { useRouter } from 'next/router';
import { ARE_DEV_ROUTES_ENABLED } from '../../../application/environment/environment.possibilities.api';
import {
  PLAYGROUND_VARIANT_PARAM,
  parsePlaygroundVariant,
} from '../../../application/playground/playground-variant';

/**
 * Candidate the /dev/playground shell asked this route to render for
 * `voteId`, or null for the production path (always null outside dev and
 * staging). Keep a variant branch next to the DZIŚ branch it replaces and
 * delete it together with the vote's registry entry once the owner decides.
 */
export function usePlaygroundVariant(voteId: string): string | null {
  const { query } = useRouter();
  if (!ARE_DEV_ROUTES_ENABLED()) {
    return null;
  }
  return parsePlaygroundVariant(query[PLAYGROUND_VARIANT_PARAM], voteId);
}
