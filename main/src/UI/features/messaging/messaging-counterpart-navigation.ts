import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { MessagingThreadMeta } from '@kernel/models/messaging/messaging.dto';
import { buildRoute } from '../../../application/routing/buildRoute';
import { withPairIntent } from '../shared/pairing/pair-intent';

/** Only thread metadata identifies the other party and the relationship reliably. */
export function counterpartNavigation(meta: MessagingThreadMeta | null) {
  const profileHref =
    meta?.viewer_side === 'CLIENT' && meta.counterpart_stylist_id
      ? buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
          identifier: meta.counterpart_stylist_id,
        })
      : null;
  return {
    profileHref,
    // REVOKED can reflect a stylist's decision. The client cannot infer its
    // cause, so the profile's existing gate remains the only way forward.
    requestHref:
      profileHref && meta?.relationship_state === 'CONTACT'
        ? withPairIntent(profileHref)
        : null,
    isPendingRequest:
      meta?.viewer_side === 'CLIENT' && meta.relationship_state === 'PENDING',
  };
}
