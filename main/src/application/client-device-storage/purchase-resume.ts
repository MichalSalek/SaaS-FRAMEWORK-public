import { z } from 'zod';
import { TIME } from '@kernel/application/constants.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { buildRoute } from '../routing/buildRoute';
import { STORAGE_KEYS } from './storage-keys.config';
import { clearPurchaseResumeOutcome } from '../analytics/purchase-resume-outcome';
import {
  deleteFromClientStorage,
  getFromClientStorage,
  setToClientStorage,
} from './clientStorage.possibilities.api';

// One device-local record, never a URL, file or draft content. Kept separate from tax returns.
const TTL_MS = TIME.MS_PER_DAY;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const action = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('upload') }).strict(),
  z.object({ kind: z.literal('gallery') }).strict(),
  z.object({ kind: z.literal('connections') }).strict(),
  z.object({ kind: z.literal('client'), clientId: id }).strict(),
  z.object({ kind: z.literal('brand') }).strict(),
  z.object({ kind: z.literal('salon') }).strict(),
  z.object({ kind: z.literal('team') }).strict(),
]);
const schema = z
  .object({
    id,
    userId: id,
    accountId: id,
    createdAt: z.number().finite(),
    action,
    sessionId: z
      .string()
      .regex(/^(?:cs_[a-zA-Z0-9_]{1,200}|change_[a-f0-9-]{36})$/)
      .nullable(),
  })
  .strict();
export type PurchaseResumeIntent = z.infer<typeof schema>;
export type PurchaseResumeAction = PurchaseResumeIntent['action'];
type Identity = Pick<PurchaseResumeIntent, 'userId' | 'accountId'>;

export function purchaseResumeIdentityOption(
  user:
    { id: string; stylist_account?: { account_id: string } | null } | undefined
): { identity: Identity } | Record<string, never> {
  return user?.stylist_account
    ? {
        identity: {
          userId: user.id,
          accountId: user.stylist_account.account_id,
        },
      }
    : {};
}

function remove(): void {
  try {
    deleteFromClientStorage({ key: STORAGE_KEYS.PURCHASE_RESUME });
  } catch {
    /* optional device storage */
  }
}

export function clearPurchaseResume(): void {
  clearPurchaseResumeOutcome();
  remove();
}

export function readPurchaseResume(
  identity: Identity,
  now = Date.now()
): PurchaseResumeIntent | null {
  try {
    const raw = getFromClientStorage({ key: STORAGE_KEYS.PURCHASE_RESUME });
    if (raw === null) {
      return null;
    }
    const parsed = schema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      parsed.data.userId !== identity.userId ||
      parsed.data.accountId !== identity.accountId ||
      parsed.data.createdAt > now ||
      now - parsed.data.createdAt >= TTL_MS
    ) {
      remove();
      return null;
    }
    return parsed.data;
  } catch {
    remove();
    return null;
  }
}

export function savePurchaseResume(
  intent: PurchaseResumeIntent,
  now = Date.now()
): boolean {
  const parsed = schema.safeParse(intent);
  if (
    !parsed.success ||
    parsed.data.createdAt > now ||
    now - parsed.data.createdAt >= TTL_MS
  ) {
    return false;
  }
  try {
    setToClientStorage({
      key: STORAGE_KEYS.PURCHASE_RESUME,
      value: JSON.stringify(parsed.data),
    });
    return true;
  } catch {
    return false;
  }
}

/** Only bind the exact still-current intent; a delayed older checkout cannot overwrite a newer one. */
export function bindPurchaseResumeSession(
  identity: Identity,
  intentId: string,
  sessionId: string
): boolean {
  const current = readPurchaseResume(identity);
  if (!current || current.id !== intentId) {
    return false;
  }
  return savePurchaseResume({ ...current, sessionId });
}

/** Build only known product routes and check the capability unlocked by the confirmed plan. */
export function resolvePurchaseResume(
  intent: PurchaseResumeIntent,
  plan: PricingPlan
): { href: string; labelKey: string } | null {
  const limits = PRICING_POLICY.LIMITS[plan];
  switch (intent.action.kind) {
    case 'upload':
      return limits.max_gallery_records === -1
        ? { href: ROUTES_FRONT.GALLERY_UPLOAD_ASSET, labelKey: 'resumeUpload' }
        : null;
    case 'gallery':
      return limits.max_gallery_records === -1
        ? { href: ROUTES_FRONT.GALLERY, labelKey: 'resumeGallery' }
        : null;
    case 'connections':
      return limits.max_paired_clients === -1
        ? { href: ROUTES_FRONT.PAIRING, labelKey: 'resumeConnections' }
        : null;
    case 'client':
      return limits.can_view_history
        ? {
            href: buildRoute(ROUTES_FRONT.CLIENT_CARD, {
              id: intent.action.clientId,
            }),
            labelKey: 'resumeClient',
          }
        : null;
    case 'brand':
      return limits.can_brand_profile
        ? {
            href: `${ROUTES_FRONT.STYLIST_PROFILE_MANAGE}?profile=personal#brand-colour`,
            labelKey: 'resumeBrand',
          }
        : null;
    case 'salon':
      return limits.can_have_salon_profile
        ? {
            href: `${ROUTES_FRONT.STYLIST_PROFILE_MANAGE}?profile=salon`,
            labelKey: 'resumeSalon',
          }
        : null;
    case 'team':
      return limits.can_use_staff_accounts
        ? { href: ROUTES_FRONT.SALON_STAFF, labelKey: 'resumeTeam' }
        : null;
  }
}

/** Clear after successful navigation only if the record has not since changed. */
export function consumePurchaseResume(
  identity: Identity,
  intentId: string,
  sessionId: string
): void {
  const current = readPurchaseResume(identity);
  if (current?.id === intentId && current.sessionId === sessionId) {
    remove();
  }
}
