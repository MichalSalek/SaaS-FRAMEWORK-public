import type { NailLength } from '../db_models.generated.dto';
export type SalonGalleryRequest = {
  salon_account_id: string;
  stylist_account_id?: string;
  cursor?: string;
  take?: number;
  color_ids?: string[];
  trait_ids?: string[];
  nail_length?: NailLength;
};
