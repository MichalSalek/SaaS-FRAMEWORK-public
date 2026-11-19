// The ONE way a salon and a person in it are named. The fallback chain lives here only: `||` skips
// an empty string where `??` keeps it, and a chain that stops at business_name can print no salon
// name at all.

type SalonNameSource = {
  salon_profile_name: string | null;
  business_name: string | null;
  display_name: string | null;
};

type PersonNameSource = {
  display_name: string | null;
  business_name: string | null;
};

/** Configured salon name, else the owner's business name, else her name. */
export const salonDisplayName = (salon: SalonNameSource): string =>
  salon.salon_profile_name || salon.business_name || salon.display_name || '';

/** A stylist as a person: her name, else her business name. */
export const stylistDisplayName = (person: PersonNameSource): string =>
  person.display_name || person.business_name || '';
