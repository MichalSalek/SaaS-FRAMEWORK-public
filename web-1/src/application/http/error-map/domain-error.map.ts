// The ONE map from every DomainError `type` to its HTTP response, composed from the per-domain maps.
//
// DECISION: per-domain maps with two compile-time guarantees replace the old monolithic switch.
// (1) Coverage: the annotation `ErrorResponderMap<DomainError>` requires a responder for EVERY
// member of the full union, so a new kernel error without one is a compile error here (the role the
// switch's `const _exhaustive: never` used to play); each domain map's `satisfies` rejects a missing
// or foreign key within its domain. (2) Uniqueness: `composeErrorMaps` rejects a type mapped by two
// domains at compile time and at load, so a spread can never let one domain silently override
// another. Do not replace the composition with a bare object spread.
import { composeErrorMaps } from './compose-error-maps';
import type { DomainError, ErrorResponderMap } from './error-map.types';
import { commonErrorMap } from './common.error-map';
import { galleryErrorMap } from './gallery.error-map';
import { pairingErrorMap } from './pairing.error-map';
import { favoriteErrorMap } from './favorite.error-map';
import { userErrorMap } from './user.error-map';
import { accountErrorMap } from './account.error-map';
import { adminErrorMap } from './admin.error-map';
import { sessionContainerErrorMap } from './session-container.error-map';
import { clientErrorMap } from './client.error-map';
import { visitErrorMap } from './visit.error-map';
import { salonStaffErrorMap } from './salon-staff.error-map';
import { emailErrorMap } from './email.error-map';
import { moderationErrorMap } from './moderation.error-map';
import { newsletterErrorMap } from './newsletter.error-map';
import { supportErrorMap } from './support.error-map';
import { contactErrorMap } from './contact.error-map';
import { messagingErrorMap } from './messaging.error-map';

export const DOMAIN_ERROR_MAP_PARTS = [
  commonErrorMap,
  galleryErrorMap,
  pairingErrorMap,
  favoriteErrorMap,
  userErrorMap,
  accountErrorMap,
  adminErrorMap,
  sessionContainerErrorMap,
  clientErrorMap,
  visitErrorMap,
  salonStaffErrorMap,
  emailErrorMap,
  moderationErrorMap,
  newsletterErrorMap,
  supportErrorMap,
  contactErrorMap,
  messagingErrorMap,
] as const;

export const DOMAIN_ERROR_RESPONDERS: ErrorResponderMap<DomainError> =
  composeErrorMaps(DOMAIN_ERROR_MAP_PARTS);
