// UI/features/checkout/hooks/useSaveVatInvoiceDetails.ts
// Faktura VAT: TQ v5 mutation — POST /api/v1/account/vat-invoice-details.
// Zapisuje dane firmowe (name/adres/NIP) na Stripe Customer PRZED checkout.confirm().
// suppressGlobalError: CheckoutForm pokazuje własny inline-błąd (vatSaveError) i
// blokuje confirm() gdy zapis się nie powiedzie — globalny snackbar byłby duplikatem.
// Stack: TanStack Query v5.

import { useMutation } from '@tanstack/react-query';
import type {
  VatInvoiceDetailsRequest,
  VatInvoiceDetailsResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import { saveVatInvoiceDetails_IO } from '../../../../domain/account/accountIO.possibilities.api';

export function useSaveVatInvoiceDetails() {
  return useMutation<
    VatInvoiceDetailsResponse,
    unknown,
    VatInvoiceDetailsRequest
  >({
    mutationFn: (req: VatInvoiceDetailsRequest) =>
      saveVatInvoiceDetails_IO(req),
    meta: { suppressGlobalError: true },
  });
}
