import { validationUtils } from './validation/validation.utils';
import { userValidators } from './validation/user.validation';
import { accountValidators } from './validation/account.validation';
import { checkoutValidators } from './validation/checkout.validation';
import { galleryValidators } from './validation/gallery.validation';
import { favoriteValidators } from './validation/favorite.validation';
import { adminValidators } from './validation/admin.validation';
import { pairingValidators } from './validation/pairing.validation';
import { miscValidators } from './validation/misc.validation';
import { emailValidators } from './validation/email.validation';
import { moderationValidators } from './validation/moderation.validation';
import { publicValidators } from './validation/public.validation';
import { sessionContainerValidators } from './validation/session-container.validation';
import { supportValidators } from './validation/support.validation';
import { visitValidators } from './validation/visit.validation';
import { messagingValidators } from './validation/messaging.validation';

export type {
  ValidationFlag,
  GenericValidationResult,
  ValidationFunction,
} from './validation/validation.types';

export {
  NO_VALIDATION,
  getErrorDTOWithoutValidationFlag,
} from './validation/validation.types';

export const VALIDATION_POLICY = {
  utils: validationUtils,
  validators: {
    ...userValidators,
    ...accountValidators,
    ...checkoutValidators,
    ...galleryValidators,
    ...favoriteValidators,
    ...adminValidators,
    ...pairingValidators,
    ...miscValidators,
    ...emailValidators,
    ...moderationValidators,
    ...publicValidators,
    ...sessionContainerValidators,
    ...supportValidators,
    ...visitValidators,
    ...messagingValidators,
  },
} as const;
