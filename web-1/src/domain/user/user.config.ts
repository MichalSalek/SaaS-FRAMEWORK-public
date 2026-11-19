/**
 * MINIMAL relations for permission checks (middleware)
 * Only loads what's needed for authorization
 */
export const userRelationsMinimal = {
  stylist_account: true, // Needed for account_id checks
  client_account: true, // Needed for client-specific permissions
};

/**
 * FULL relations for user profile/data endpoints
 * Loads all user-related data
 *
 * DECISION: cap of 100 on sessions/favorite_stylists/favorite_records. A power user can have thousands of
 * rows in these relations, and an unbounded fetch in 8+ user operations means payload growth, memory
 * pressure and slow queries. Consumers do not use the full lists (the UI has its own paginated
 * endpoints); orderBy created_at desc keeps the newest first, deterministically. A use case needing full
 * relations should get a purpose-specific config (e.g. userForBackup), not a bigger cap.
 */
export const userRelationsEnabler = {
  // DECISION: `select` WITHOUT `token`, parity with userRelationsArchiveEnabler below. The result of this
  // include goes back to the CLIENT through `toSafeCurrentUser`, so become-user and switch-back returned
  // raw bearers (up to 100 of the admin's sessions) in the response body; the sanitizer stripped the token
  // only from the single `session`, and the type missed it because `sessions` is not declared in
  // SafeCurrentUser. A credential must not even enter memory on a path that ends in a response body;
  // session metadata (expiry/IP/device) stays.
  sessions: {
    take: 100,
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      expires: true,
      ip_address: true,
      user_agent: true,
      device_type: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  stylist_account: true,
  client_account: true,
  // event_logs is not included: EventLog is a soft FK with no relation to User. Events are queried
  // directly by created_by_user_id and survive account deletion.
  favorite_stylists: { take: 100, orderBy: { created_at: 'desc' as const } },
  favorite_records: { take: 100, orderBy: { created_at: 'desc' as const } },
};

export const userRelationsArchiveEnabler = {
  freeEmailEnrollments: true,
  emailLifecycleActions: true,
  emailLifecycleMessages: {
    include: { deliveryEvents: true, entries: true, operationalEvents: true },
  },
  emailLifecycleEntries: true,
  // select WITHOUT token (@map session_token = bearer credential), same as `accounts` below: auth
  // secrets stay out of the indefinite raw archive (breach liability; dead after the cascade anyway).
  // Session metadata (expiry/IP/device) is kept for analytics.
  sessions: {
    select: {
      id: true,
      expires: true,
      ip_address: true,
      user_agent: true,
      device_type: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  accounts: {
    select: {
      id: true,
      providerId: true,
      accountId: true,
      scope: true,
      accessTokenExpiresAt: true,
      refreshTokenExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  stylist_account: {
    include: {
      salon_showcase_works: true,
      gallery_record: {
        include: {
          colors: { select: { color_id: true } },
          traits: { select: { trait_id: true } },
        },
      },
      // Client card / Visual CRM: data the stylist owns as AUTHOR. Without it, deleting a stylist
      // account cascaded away her whole visit history and CRM notes with no copy.
      // DECISION: `include: { messages: true }`, not `true`. StylistClientMessage cascades from
      // ClientStylistPair, so plain `true` archives the pair row (crm_note) but not its thread, which
      // every terminal delete would then wipe with no copy. Deliberately no `take`: a truncated
      // archive looks complete and is not. Size is bounded by the hourly send limit.
      stylist_pairings: { include: { messages: true } }, // crm_note + crm_note_updated_at + thread
      stylist_visits: { include: { result_photos: true } }, // visit history + result photos
      staff_members: true, // roster salonu (SalonStaff)
      // select WITHOUT token (@unique VarChar(32), single-use pairing secret), like sessions/accounts:
      // the secret stays out of the raw archive. Pairing metadata is kept.
      pairing_sessions: {
        select: {
          id: true,
          stylist_account_id: true,
          issued_by_user_id: true,
          created_at: true,
          expires_at: true,
          claimed_by_client_user_id: true,
          claimed_at: true,
          revoked_at: true,
        },
      },
    },
  },
  client_account: {
    include: {
      session_containers: { include: { photos: true } }, // session-share scaffold + zdjęcia
    },
  },
  favorite_stylists: true,
  favorite_records: true,
  // The other side of the same pair; see the DECISION at `stylist_pairings` above.
  client_pairings: { include: { messages: true } },
  client_visits: { include: { result_photos: true } }, // wizyty od strony klientki + zdjęcia
  staff_memberships: true,
  moderation_strike_records: true,
  // `content_reports` DELIBERATELY has no relation here: `ContentReport.reporter_id` is a
  // soft-FK (see the DECISION at the model in schema.prisma), so reports SURVIVE account
  // deletion in their own table and the archive has nothing to duplicate, exactly like
  // EventLog and ContactAccessLog, listed above as soft-FK survivors.
};
