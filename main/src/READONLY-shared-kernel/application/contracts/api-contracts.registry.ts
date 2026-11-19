import { ACCOUNT_CONTRACTS } from '../../domain/account/account.contracts';
import { ADMIN_CONTRACTS } from '../../domain/admin/admin.contracts';
import { APPLICATION_CONTRACTS } from '../../domain/application/application.contracts';
import { CLIENT_CONTRACTS } from '../../domain/client/client.contracts';
import { EMAIL_CONTRACTS } from '../../domain/email/email.contracts';
import { EVENT_LOG_CONTRACTS } from '../../domain/event-log/event-log.contracts';
import { FAVORITE_CONTRACTS } from '../../domain/favorites/favorite.contracts';
import { GALLERY_CONTRACTS } from '../../domain/gallery/gallery.contracts';
import { MESSAGING_CONTRACTS } from '../../domain/messaging/messaging.contracts';
import { NEWSLETTER_CONTRACTS } from '../../domain/newsletter/newsletter.contracts';
import { NOTIFICATIONS_CONTRACTS } from '../../domain/notifications/notifications.contracts';
import { PAIRING_CONTRACTS } from '../../domain/pairing/pairing.contracts';
import { PRICING_CONTRACTS } from '../../domain/pricing/pricing.contracts';
import { PUBLIC_CONTRACTS } from '../../domain/public/public.contracts';
import { SALON_PROFILE_CONTRACTS } from '../../domain/salon-profile/salon-profile.contracts';
import { SALON_STAFF_CONTRACTS } from '../../domain/salon-staff/salon-staff.contracts';
import { SESSION_CONTAINER_CONTRACTS } from '../../domain/session-container/session-container.contracts';
import { SESSION_CONTRACTS } from '../../domain/session/session.contracts';
import { SUPPORT_CONTRACTS } from '../../domain/support/support.contracts';
import { USER_CONTRACTS } from '../../domain/user/user.contracts';
import { VISIT_CONTRACTS } from '../../domain/visit/visit.contracts';
import type { ApiContract } from './contract.types';

/**
 * Every endpoint declared through a contract, by domain. A migrated domain is added here once; its
 * operations then reach the generated legacy registries (`npm run system:contracts`).
 *
 * `dto` names the legacy `<DOMAIN>_DTO_API_V1` type and its file under `models/`, which the generator
 * rewrites from the contracts (compatibility layer for code and the OpenAPI generator).
 */
export const CONTRACT_DOMAINS = [
  {
    exportName: 'FAVORITE_CONTRACTS',
    typeName: 'FavoriteContracts',
    source: 'domain/favorites/favorite.contracts.ts',
    dto: {
      typeName: 'FAVORITE_DTO_API_V1',
      file: 'models/favorites/favorite.dto.ts',
    },
    contracts: FAVORITE_CONTRACTS,
  },
  {
    exportName: 'SUPPORT_CONTRACTS',
    typeName: 'SupportContracts',
    source: 'domain/support/support.contracts.ts',
    dto: {
      typeName: 'SUPPORT_DTO_API_V1',
      file: 'models/support/support.dto.ts',
    },
    contracts: SUPPORT_CONTRACTS,
  },
  {
    exportName: 'NOTIFICATIONS_CONTRACTS',
    typeName: 'NotificationsContracts',
    source: 'domain/notifications/notifications.contracts.ts',
    dto: {
      typeName: 'NOTIFICATIONS_DTO_API_V1',
      file: 'models/notifications/notifications.dto.ts',
    },
    contracts: NOTIFICATIONS_CONTRACTS,
  },
  {
    exportName: 'SESSION_CONTAINER_CONTRACTS',
    typeName: 'SessionContainerContracts',
    source: 'domain/session-container/session-container.contracts.ts',
    dto: {
      typeName: 'SESSION_CONTAINER_DTO_API_V1',
      file: 'models/session-container/session-container.dto.ts',
    },
    contracts: SESSION_CONTAINER_CONTRACTS,
  },
  {
    exportName: 'MESSAGING_CONTRACTS',
    typeName: 'MessagingContracts',
    source: 'domain/messaging/messaging.contracts.ts',
    dto: {
      typeName: 'MESSAGING_DTO_API_V1',
      file: 'models/messaging/messaging.dto.ts',
    },
    contracts: MESSAGING_CONTRACTS,
  },
  {
    exportName: 'CLIENT_CONTRACTS',
    typeName: 'ClientContracts',
    source: 'domain/client/client.contracts.ts',
    dto: {
      typeName: 'CLIENT_DTO_API_V1',
      file: 'models/client/client.dto.ts',
    },
    contracts: CLIENT_CONTRACTS,
  },
  {
    exportName: 'PAIRING_CONTRACTS',
    typeName: 'PairingContracts',
    source: 'domain/pairing/pairing.contracts.ts',
    dto: {
      typeName: 'PAIRING_DTO_API_V1',
      file: 'models/pairing/pairing.dto.ts',
    },
    contracts: PAIRING_CONTRACTS,
  },
  {
    exportName: 'NEWSLETTER_CONTRACTS',
    typeName: 'NewsletterContracts',
    source: 'domain/newsletter/newsletter.contracts.ts',
    dto: {
      typeName: 'NEWSLETTER_DTO_API_V1',
      file: 'models/newsletter/newsletter.dto.ts',
    },
    contracts: NEWSLETTER_CONTRACTS,
  },
  {
    exportName: 'EMAIL_CONTRACTS',
    typeName: 'EmailContracts',
    source: 'domain/email/email.contracts.ts',
    dto: {
      typeName: 'EMAIL_DTO_API_V1',
      file: 'models/email/email.dto.ts',
    },
    contracts: EMAIL_CONTRACTS,
  },
  {
    exportName: 'PUBLIC_CONTRACTS',
    typeName: 'PublicContracts',
    source: 'domain/public/public.contracts.ts',
    dto: {
      typeName: 'PUBLIC_DTO_API_V1',
      file: 'models/public/public.dto.ts',
    },
    contracts: PUBLIC_CONTRACTS,
  },
  {
    exportName: 'EVENT_LOG_CONTRACTS',
    typeName: 'EventLogContracts',
    source: 'domain/event-log/event-log.contracts.ts',
    dto: {
      typeName: 'EVENT_LOG_DTO_API_V1',
      file: 'models/event-log/event_log.dto.ts',
    },
    contracts: EVENT_LOG_CONTRACTS,
  },
  {
    exportName: 'PRICING_CONTRACTS',
    typeName: 'PricingContracts',
    source: 'domain/pricing/pricing.contracts.ts',
    dto: {
      typeName: 'PRICING_DTO_API_V1',
      file: 'models/pricing/pricing.dto.ts',
    },
    contracts: PRICING_CONTRACTS,
  },
  {
    exportName: 'APPLICATION_CONTRACTS',
    typeName: 'ApplicationContracts',
    source: 'domain/application/application.contracts.ts',
    dto: {
      typeName: 'APPLICATION_DTO_API_V1',
      file: 'models/application/application.dto.ts',
    },
    contracts: APPLICATION_CONTRACTS,
  },
  {
    exportName: 'ADMIN_CONTRACTS',
    typeName: 'AdminContracts',
    source: 'domain/admin/admin.contracts.ts',
    dto: {
      typeName: 'ADMIN_DTO_API_V1',
      file: 'models/admin/admin.dto.ts',
    },
    contracts: ADMIN_CONTRACTS,
  },
  {
    exportName: 'USER_CONTRACTS',
    typeName: 'UserContracts',
    source: 'domain/user/user.contracts.ts',
    dto: {
      typeName: 'USER_DTO_API_V1',
      file: 'models/user/user.dto.ts',
    },
    contracts: USER_CONTRACTS,
  },
  {
    exportName: 'SESSION_CONTRACTS',
    typeName: 'SessionContracts',
    source: 'domain/session/session.contracts.ts',
    dto: {
      typeName: 'SESSION_DTO_API_V1',
      file: 'models/session/session.dto.ts',
    },
    contracts: SESSION_CONTRACTS,
  },
  {
    exportName: 'ACCOUNT_CONTRACTS',
    typeName: 'AccountContracts',
    source: 'domain/account/account.contracts.ts',
    dto: {
      typeName: 'ACCOUNT_DTO_API_V1',
      file: 'models/account/account.dto.ts',
    },
    contracts: ACCOUNT_CONTRACTS,
  },
  {
    exportName: 'GALLERY_CONTRACTS',
    typeName: 'GalleryContracts',
    source: 'domain/gallery/gallery.contracts.ts',
    dto: {
      typeName: 'GALLERY_DTO_API_V1',
      file: 'models/gallery/gallery.dto.ts',
    },
    contracts: GALLERY_CONTRACTS,
  },
  {
    exportName: 'SALON_PROFILE_CONTRACTS',
    typeName: 'SalonProfileContracts',
    source: 'domain/salon-profile/salon-profile.contracts.ts',
    dto: {
      typeName: 'SALON_PROFILE_DTO_API_V1',
      file: 'models/salon-profile/salon-profile.dto.ts',
    },
    contracts: SALON_PROFILE_CONTRACTS,
  },
  {
    exportName: 'SALON_STAFF_CONTRACTS',
    typeName: 'SalonStaffContracts',
    source: 'domain/salon-staff/salon-staff.contracts.ts',
    dto: {
      typeName: 'SALON_STAFF_DTO_API_V1',
      file: 'models/salon-staff/salon-staff.dto.ts',
    },
    contracts: SALON_STAFF_CONTRACTS,
  },
  {
    exportName: 'VISIT_CONTRACTS',
    typeName: 'VisitContracts',
    source: 'domain/visit/visit.contracts.ts',
    dto: {
      typeName: 'VISIT_DTO_API_V1',
      file: 'models/visit/visit.dto.ts',
    },
    contracts: VISIT_CONTRACTS,
  },
] as const;

export const API_CONTRACTS = {
  ...FAVORITE_CONTRACTS,
  ...SUPPORT_CONTRACTS,
  ...NOTIFICATIONS_CONTRACTS,
  ...SESSION_CONTAINER_CONTRACTS,
  ...MESSAGING_CONTRACTS,
  ...CLIENT_CONTRACTS,
  ...PAIRING_CONTRACTS,
  ...NEWSLETTER_CONTRACTS,
  ...EMAIL_CONTRACTS,
  ...PUBLIC_CONTRACTS,
  ...EVENT_LOG_CONTRACTS,
  ...PRICING_CONTRACTS,
  ...APPLICATION_CONTRACTS,
  ...ADMIN_CONTRACTS,
  ...USER_CONTRACTS,
  ...SESSION_CONTRACTS,
  ...ACCOUNT_CONTRACTS,
  ...GALLERY_CONTRACTS,
  ...SALON_PROFILE_CONTRACTS,
  ...SALON_STAFF_CONTRACTS,
  ...VISIT_CONTRACTS,
} as const;

export const API_CONTRACT_LIST: readonly ApiContract[] =
  Object.values(API_CONTRACTS);
