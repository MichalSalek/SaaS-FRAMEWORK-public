import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { PricingPlanValue } from '../pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '../../models/db_models.generated.dto';

const nullableInstant = wireInstant.nullable();

const emailPreferencesSchema = z
  .object({
    trial_sequence: z.boolean(),
    marketing: z.boolean(),
  })
  .nullable();

export const stylistAccountRowSchema = z.object({
  account_id: z.string(),
  created_by_user_id: z.string(),
  display_name: z.string().nullable(),
  pricing_plan: z.enum(PricingPlanValue),
  payment_status: z.enum(PaymentStatusValue),
  account_status: z.enum(AccountStatusValue),
  paid_staff_seats: z.number(),
  account_expiration_date: nullableInstant,
  upcoming_payment_date: nullableInstant,
  business_name: z.string().nullable(),
  address_street: z.string().nullable(),
  address_city: z.string().nullable(),
  address_postal_code: z.string().nullable(),
  address_country: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  dashboard_note: z.string().nullable(),
  vanity_url: z.string().nullable(),
  instagram_handle: z.string().nullable(),
  avatar_url: z.string().nullable(),
  avatar_public_id: z.string().nullable(),
  brand_accent_color: z.string().nullable(),
  salon_vanity_url: z.string().nullable(),
  salon_profile_name: z.string().nullable(),
  salon_brand_accent_color: z.string().nullable(),
  salon_show_team: z.boolean(),
  stripe_customer_id: z.string().nullable(),
  subscription_id: z.string().nullable(),
  subscription_status: z.enum(SubscriptionStatusValue).nullable(),
  cancel_at_period_end: z.boolean().nullable(),
  cancel_at: nullableInstant,
  current_period_end: nullableInstant,
  last_stripe_event_at: nullableInstant,
  trial_started_at: nullableInstant,
  trial_ends_at: nullableInstant,
  trial_reminder_sent: z.boolean().nullable(),
  plan_selected_at: nullableInstant,
  email_preferences: emailPreferencesSchema,
  email_marketing: z.boolean(),
  email_trial_sequence: z.boolean(),
  admin_plan_override: z.boolean(),
  gallery_strength_dismissed_at: nullableInstant,
  view_count: z.number(),
  cached_bookmark_count: z.number(),
  cached_gallery_count: z.number(),
  cached_likes_count: z.number(),
  created_at: wireInstant,
});

export const stylistsWithLocationSchema = z.array(
  z.object({
    account_id: z.string(),
    business_name: z.string().nullable(),
    address_city: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
    display_name: z.string().nullable(),
    gallery_count: z.number(),
  })
);

export const stylistProfileUpdatedSchema = z.object({
  account_id: z.string(),
  updated_sections: z.array(
    z.enum(['location', 'bio', 'vanity', 'social', 'links', 'branding'])
  ),
  address_city: z.string().nullable(),
  address_street: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  business_name: z.string().nullable(),
  vanity_url: z.string().nullable(),
  instagram_handle: z.string().nullable(),
  brand_accent_color: z.string().nullable(),
});

export const avatarSetSchema = z.object({
  account_id: z.string(),
  avatar_url: z.string().nullable(),
});

export const galleryStrengthDismissedSchema = z.object({
  account_id: z.string(),
  gallery_strength_dismissed_at: z.string(),
});

export const publicProfileSchema = z.object({
  account: z.object({
    account_id: z.string(),
    display_name: z.string().nullable(),
    business_name: z.string().nullable(),
    address_city: z.string().nullable(),
    address_street: z.string().nullable(),
    address_country: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    external_links: z.array(z.string()).max(3).nullable().optional(),
    effective_pricing_plan: z.string().nullable().optional(),
    description: z.string().nullable(),
    vanity_url: z.string().nullable(),
    view_count: z.number(),
    instagram_handle: z.string().nullable(),
    avatar_url: z.string().nullable(),
    avatar_fallback_url: z.string().nullable().optional(),
    brand_accent_color: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  }),
  salon_link: z
    .object({
      salon_vanity_url: z.string().nullable().optional(),
      account_id: z.string(),
      name: z.string(),
      role: z.enum(['owner', 'stylist']),
    })
    .nullable()
    .optional(),
  gallery_records_count: z.number(),
  pinned_photo_urls: z.array(z.string()),
  bookmark_count: z.number(),
  total_likes: z.number(),
});

export const resolvedProfileLinkSchema = z.object({
  account_id: z.string(),
  current_slug: z.string().nullable(),
});

export const portalUrlSchema = z.object({ url: z.string() });

export const checkoutSessionResponseSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('free_selected') }),
  z.object({
    mode: z.literal('checkout_elements'),
    trialDays: z.number().int().nonnegative().optional(),
    billingAddressRequired: z.boolean().optional(),
    clientSecret: z.string(),
    checkoutSessionId: z.string(),
    returnUrl: z.string(),
    promoRejected: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal('hosted_fallback'),
    trialDays: z.number().int().nonnegative().optional(),
    billingAddressRequired: z.boolean().optional(),
    url: z.string(),
    checkoutSessionId: z.string(),
    promoRejected: z.boolean().optional(),
  }),
]);

export const planChangeResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed') }),
  z.object({
    status: z.literal('requires_action'),
    clientSecret: z.string(),
  }),
  z.object({
    status: z.literal('payment_failed'),
    reason: z.string().optional(),
  }),
]);

export const vatInvoiceSavedSchema = z.object({ ok: z.literal(true) });

export const viewCountSchema = z.object({ view_count: z.number() });

export const dashboardNoteSetSchema = z.object({
  dashboard_note: z.string().nullable(),
});

export const dashboardNoteReadSchema = z.object({
  stylist_note: z.string().nullable(),
  client_note: z.string().nullable(),
});

export const dashboardFeedSchema = z.object({
  gallery_strength_score: z.number(),
  gallery_strength_dismissed: z.boolean(),
  total_views: z.number(),
  active_pairs_count: z.number(),
  pending_shares_count: z.number(),
  recent_bookmarks_count: z.number(),
  recent_gallery_records: z.array(
    z.object({
      gallery_record_id: z.string(),
      image_url: z.string(),
      created_at: z.string(),
    })
  ),
  photo_count: z.number(),
  pinned_count: z.number(),
  like_count: z.number(),
  paired_client_count: z.number(),
  member_since: z.string(),
  profile_view_count: z.number(),
});

const privateNoteClientSchema = z.object({
  client_user_id: z.string(),
  name: z.string().nullable(),
});

export const privateNotesSchema = z.object({
  history_locked: z.boolean(),
  important_notes: z.array(
    z.object({
      client: privateNoteClientSchema,
      note: z.string(),
      updated_at: z.string(),
    })
  ),
  important_notes_truncated: z.boolean(),
  clients: z.array(privateNoteClientSchema),
  client_notes: z.array(
    z.object({
      client: privateNoteClientSchema,
      note: z.string(),
      updated_at: z.string(),
    })
  ),
  client_notes_truncated: z.boolean(),
  session_notes: z.array(
    z.object({
      session_id: z.string(),
      session_name: z.string().nullable(),
      client: privateNoteClientSchema,
      author: z.enum(['STYLIST', 'CLIENT']),
      note: z.string(),
      updated_at: z.string(),
    })
  ),
  session_notes_truncated: z.boolean(),
  visit_notes: z.array(
    z.object({
      visit_id: z.string(),
      client: privateNoteClientSchema,
      note: z.string(),
      visit_date: z.string(),
    })
  ),
  visit_notes_truncated: z.boolean(),
});
