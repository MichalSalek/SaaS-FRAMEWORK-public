// UI/features/checkout/hooks/useSaveVatInvoiceDetails.ts
// VAT invoice: TQ v5 mutation — POST /api/v1/account/vat-invoice-details.
// Saves the company data (name/address/NIP) on the Stripe Customer BEFORE checkout.confirm().
// suppressGlobalError: CheckoutForm shows its own inline error (vatSaveError) and blocks confirm()
// when the save fails — a global snackbar would be a duplicate.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type {
  VatInvoiceDetailsRequest,
  VatInvoiceDetailsResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import { saveVatInvoiceDetails_IO } from '../../../../domain/account/accountIO.possibilities.api';

export function useSaveVatInvoiceDetails() {
  const queryClient = useQueryClient();
  return useMutation<
    VatInvoiceDetailsResponse,
    unknown,
    VatInvoiceDetailsRequest
  >({
    mutationFn: (req: VatInvoiceDetailsRequest) =>
      saveVatInvoiceDetails_IO(req),
    // Stripe may have created a tax ID before a later Customer update failed.
    // Refresh on either outcome; an unreadable profile blocks checkout upstream.
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.account.billingProfile,
      });
    },
    meta: { suppressGlobalError: true },
  });
}
