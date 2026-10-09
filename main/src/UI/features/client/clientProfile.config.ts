// UI/features/client/clientProfile.config.ts
// Switches of the client's own profile screen.

/**
 * DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08:
 * the „Twoje preferencje” section (colours, lengths, styles) is OFF.
 *
 * It was the whole first screen of the profile and stored nothing: the three
 * selections lived in `useState`, vanished on reload and no stylist could ever
 * see them (its own footnote said so). A control that pretends to work is not
 * acceptable, so the section does not render until saving exists.
 *
 * What must exist before this goes back to `true`:
 *  1. a place in the database for the three axes on `ClientAccount` (today it
 *     has only `contact_phone`, `contact_email`, `dashboard_note`), with the
 *     colour-palette and style buckets defined in the kernel (only
 *     `NAIL_LENGTHS` exists there);
 *  2. the fields in `CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE']` and a
 *     command that writes them (today the only write is
 *     `CLIENT_UPDATE_CONTACT`: phone and e-mail);
 *  3. in `ClientProfilePreferences.organism.tsx`: the three `useState` sets
 *     replaced by the query data plus an optimistic mutation with rollback, and
 *     the `preferencesNote` paragraph removed;
 *  4. a reader on the stylist's side (the client card), otherwise the choice is
 *     saved for nobody.
 *
 * The component and its copy (`pages.clientProfile.preferences*`,
 * `colorPalettes`, `nailLengths`, `styles`) are kept on purpose.
 */
export const CLIENT_PREFERENCES_ENABLED: boolean = false;
