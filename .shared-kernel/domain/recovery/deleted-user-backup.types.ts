import type {
  AccountStatus,
  AccountType,
  NailLength,
  PaymentStatus,
} from '../../models/db_models.generated.dto';
import type { SystemRoleIdType } from '../../models/db_models.manual.dto';
import type { PricingPlan } from '../pricing/pricing.config';

/**
 * Typed interface for DeletedUser.body JSON content.
 * This is the shape of UserWithRelations at the time of deletion.
 * Used for account recovery (restore from backup).
 */
export type DeletedUserBackup = {
  id: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  name: string;
  role_id: SystemRoleIdType;
  is_active: boolean;
  account_type: AccountType;
  // Prisma camelCases this field in JSON output (DB column is created_at via @map)
  createdAt: string;

  stylist_account: DeletedUserBackupStylistAccount | null;
  client_account: DeletedUserBackupClientAccount | null;
};

export type DeletedUserBackupStylistAccount = {
  account_id: string;
  display_name: string | null;
  pricing_plan: PricingPlan;
  payment_status: PaymentStatus;
  account_status: AccountStatus;
  business_name: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  vanity_url: string | null;

  gallery_record?: DeletedUserBackupGalleryRecord[];
};

export type DeletedUserBackupGalleryRecord = {
  gallery_record_id: string;
  asset_url: string;
  nail_length: NailLength | null;
  is_pinned: boolean;

  // Post-Colors/Traits migration: junction tables
  colors?: Array<{ color_id: string }>;
  traits?: Array<{ trait_id: string }>;
};

export type DeletedUserBackupClientAccount = {
  contact_phone: string | null;
  contact_email: string | null;
};

export const RECOVERY_CONFIG = {
  // FAZA C: okno odzyskiwania 30d -> 90d. Po wygaśnięciu interceptor robi MOVE
  // (moveExpiredUserToArchive_IO): pełny snapshot -> DeletedUser.body, DELETE User (email wolny).
  // To okno = JEDNOCZEŚNIE okno recovery (login = reaktywacja in-place) I wiek wyzwalający MOVE.
  MAX_DAYS: 90,
} as const;
