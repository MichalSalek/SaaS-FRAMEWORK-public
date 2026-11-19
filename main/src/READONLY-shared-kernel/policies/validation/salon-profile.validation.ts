import {
  salonProfileContactSchema,
  salonProfileUpdateSchema,
  salonProfileVisibilitySchema,
  salonSlugAvailabilitySchema,
} from '../../domain/salon-profile/salon-profile.contract-schemas';
import { zodValidate } from './validation.zod';

export const salonProfileValidators = {
  salonProfileContact: (data: unknown) =>
    zodValidate(salonProfileContactSchema, data),
  salonSlugAvailability: (data: unknown) =>
    zodValidate(salonSlugAvailabilitySchema, data),
  salonProfileUpdate: (data: unknown) =>
    zodValidate(salonProfileUpdateSchema, data),
  salonProfileVisibility: (data: unknown) =>
    zodValidate(salonProfileVisibilitySchema, data),
};
