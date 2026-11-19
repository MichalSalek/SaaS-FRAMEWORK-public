// Types shared by the per-domain error maps and the composed DOMAIN_ERROR_RESPONDERS.
import type { NextApiResponse } from 'next';

import type { GalleryError } from '@kernel/domain/gallery/gallery-errors.types';
import type { PairingError } from '@kernel/domain/pairing/pairing-errors.types';
import type { FavoriteError } from '@kernel/domain/favorites/favorite-errors.types';
import type { UserError } from '@kernel/domain/user-and-account/user-errors.types';
import type { AccountError } from '@kernel/domain/user-and-account/account-errors.types';
import type { AdminError } from '@kernel/domain/admin/admin-errors.types';
import type { SessionContainerError } from '@kernel/domain/session-container/session-container-errors.types';
import type { ClientError } from '@kernel/domain/client/client-errors.types';
import type { VisitError } from '@kernel/domain/visit/visit-errors.types';
import type { SalonStaffError } from '@kernel/domain/salon-staff/salon-staff-errors.types';
import type { EmailError } from '@kernel/domain/email/email-errors.types';
import type { ModerationError } from '@kernel/domain/moderation/moderation-errors.types';
import type { NewsletterError } from '@kernel/domain/newsletter/newsletter-errors.types';
import type { SupportError } from '@kernel/domain/support/support-errors.types';
import type { ContactError } from '@kernel/domain/contact/contact-errors.types';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import type { CommonError } from '@kernel/application/common-errors.types';

// DECISION: every domain enters `DomainError` through its own UNION, never by listing individual
// members. A domain imported as separate types (newsletter once was) does not widen `DomainError`
// when the kernel union gains a variant, so the composed map's coverage check keeps compiling and
// the new error falls into an opaque 500. The union import turns a new member into an immediate
// compile error in `domain-error.map.ts`. Do not simplify back to a list of single types.
export type DomainError =
  | CommonError
  | GalleryError
  | PairingError
  | FavoriteError
  | UserError
  | AccountError
  | AdminError
  | SessionContainerError
  | ClientError
  | VisitError
  | SalonStaffError
  | EmailError
  | ModerationError
  | NewsletterError
  | SupportError
  | ContactError
  | MessagingError;

type TypedError = { type: string };

export type ErrorResponder<E> = (res: NextApiResponse, error: E) => void;

/** `type` discriminant → the union member that carries it. */
export type ErrorsByType<U extends TypedError> = {
  [K in U['type']]: Extract<U, { type: K }>;
};

/**
 * One responder per member of `U`, keyed by its `type`. Used with `satisfies` on every domain map:
 * a member without a responder and a key outside `U` are both compile errors. The shape (a mapped
 * type over a lookup type) is what lets `mapErrorToResponse` call `map[error.type](res, error)`
 * without a cast (correlated union, TypeScript #47109).
 */
export type ErrorResponderMap<U extends TypedError> = {
  [K in U['type']]: ErrorResponder<ErrorsByType<U>[K]>;
};

/**
 * The members a domain map owns. Some kernel domain unions re-export a common error
 * (`ContactError` includes `ExternalServiceError`); the common map owns those, so a domain map never
 * maps them a second time.
 */
export type OwnErrors<U extends TypedError> = Exclude<U, CommonError>;
