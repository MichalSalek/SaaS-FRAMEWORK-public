import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';

type PairedItem =
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE']['pairs'][number];

export type PairedStylist = Extract<PairedItem, { account_id: string }>;
export type PairedClient = Extract<PairedItem, { user_id: string }>;

export const isPairedStylist = (item: PairedItem): item is PairedStylist => {
  return 'account_id' in item;
};

export const isPairedClient = (item: PairedItem): item is PairedClient => {
  return 'user_id' in item;
};
