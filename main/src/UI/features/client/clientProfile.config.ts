// UI/features/client/clientProfile.config.ts
// Switches of the client's own profile screen.

/**
 * DECISION: the "Twoje preferencje" section (colours, lengths, styles) is OFF. It was the whole
 * first screen of the profile and stored nothing: the three selections lived in `useState`, vanished
 * on reload and no stylist could ever see them. A control that pretends to work does not render
 * until saving exists. Before this goes back to `true`: (1) a place in the database for the three
 * axes on `ClientAccount`, with colour-palette and style buckets in the kernel (only `NAIL_LENGTHS`
 * exists there); (2) the fields in `CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE']` and a
 * command that writes them; (3) in `ClientProfilePreferences.organism.tsx` the `useState` sets
 * replaced by query data plus an optimistic mutation with rollback, and `preferencesNote` removed;
 * (4) a reader on the stylist side (the client card), otherwise the choice is saved for nobody. The
 * component and its copy (`pages.clientProfile.preferences*`, `colorPalettes`, `nailLengths`,
 * `styles`) are kept on purpose. (owner)
 */
export const CLIENT_PREFERENCES_ENABLED: boolean = false;
