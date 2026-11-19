import { contractEndpoint } from '../../application/http/io';
import { SALON_PROFILE_CONTRACTS } from '@kernel/domain/salon-profile/salon-profile.contracts';

export const getSalonProfile_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_GET
);
export const updateSalonProfile_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_UPDATE
);
export const updateSalonProfileVisibility_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_VISIBILITY_UPDATE
);
export const getSalonProfileVisibility_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_VISIBILITY_GET
);
export const getPublicSalonProfile_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_PUBLIC_GET
);
export const checkSalonSlug_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_SLUG_AVAILABLE
);
export const contactSalonStylist_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_CONTACT
);

export const setSalonLogo_IO = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_SET_LOGO
);
