import { salonGallerySchema } from '../../domain/salon-profile/salon-profile.contract-schemas';
import { zodValidate } from '../../policies/validation/validation.zod';

export { salonGallerySchema };

export const validateSalonGallery = (data: unknown) =>
  zodValidate(salonGallerySchema, data);
