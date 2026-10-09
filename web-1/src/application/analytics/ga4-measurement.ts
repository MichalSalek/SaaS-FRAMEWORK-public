/**
 * GA4 Measurement Protocol — serwerowe zdarzenie `purchase`.
 *
 * Do tej pory nailfolio nie raportowało przychodu do GA4 ŻADNYM kanałem: ani z
 * przeglądarki, ani z serwera. Pierwsza płatna subskrypcja byłaby więc w
 * raportach niewidoczna, a bez przychodu nie da się powiedzieć, czy cokolwiek
 * w górze lejka się zwraca.
 *
 * Kanał serwerowy, nie przeglądarkowy, z dwóch powodów: odnowienia subskrypcji
 * w ogóle nie mają przeglądarki (Stripe nalicza je sam co miesiąc), a przy
 * pierwszej płatności klientka nie zawsze wraca na stronę powrotu.
 *
 * Env: `GA4_MEASUREMENT_ID` + `GA4_API_SECRET` (GA4 → Administracja → Strumienie
 * danych → Measurement Protocol). SERVER-ONLY, nigdy z prefiksem NEXT_PUBLIC.
 * Brak któregokolwiek = cicha bezczynność, więc kod jest bezpieczny na produkcji
 * zanim sekrety powstaną.
 */

import { ENV_VARS } from '@app/environment/environment.config';

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const REQUEST_TIMEOUT_MS = 5_000;

export interface GA4PurchaseParams {
  /** ID faktury Stripe — stabilne przy retry, więc służy za `transaction_id`. */
  transactionId: string;
  /** Wartość towaru BEZ podatku, w jednostkach głównych (złotówki, nie grosze). */
  value: number;
  /** Kwota podatku, osobno — GA4 rozdziela przychód od podatku. */
  tax: number;
  /** ISO 4217, wielkimi literami. */
  currency: string;
  /** Plan ze snapshotu metadanych subskrypcji na fakturze. */
  planId: string;
  /** 'month' | 'year' — ta sama kwota znaczy co innego przy każdym z nich. */
  billingPeriod: string;
  /**
   * Powód naliczenia ze Stripe (`subscription_create`, `subscription_cycle`,
   * `subscription_update`…). Bez tego wymiaru nie da się odróżnić nowego
   * klienta od odnowienia, a w raporcie oba są po prostu `purchase`.
   */
  billingReason: string;
  /**
   * `client_id` GA4 z przeglądarki, przeniesiony przez metadane subskrypcji.
   * Bez niego Measurement Protocol wymyśla użytkownika-widmo i zakup nie
   * doklei się do nikogo, kto wcześniej chodził po stronie.
   */
  clientId?: string | undefined;
  /**
   * ID klienta Stripe — zastępnik tożsamości, gdy brak `clientId`. STABILNY
   * między odnowieniami, w odróżnieniu od ID faktury, które zmienia się co
   * miesiąc i robiłoby z jednego abonenta nowego użytkownika przy każdej racie.
   */
  customerId?: string | undefined;
}

/**
 * Wyślij `purchase` do GA4. Nigdy nie rzuca — wołający jest efektem
 * post-commit, a odrzucony promise w `runAfterResponse` idzie do globalnego
 * uchwytu nieobsłużonych odrzuceń.
 */
export async function sendGA4Purchase(
  params: GA4PurchaseParams
): Promise<void> {
  try {
    const measurementId = ENV_VARS.GA4_MEASUREMENT_ID;
    const apiSecret = ENV_VARS.GA4_API_SECRET;
    if (!measurementId || !apiSecret) {
      return;
    }

    // Kolejność zastępników ma znaczenie. Bez tożsamości z przeglądarki
    // bierzemy ID KLIENTA Stripe: jest stałe przez całe życie subskrypcji, więc
    // dwanaście rat to jeden użytkownik, a nie dwunastu. ID faktury jest
    // ostatnią deską ratunku i zmienia się co miesiąc — stąd taka kolejność.
    const clientId =
      params.clientId ?? params.customerId ?? params.transactionId;

    const body = {
      client_id: clientId,
      events: [
        {
          name: 'purchase',
          params: {
            transaction_id: params.transactionId,
            currency: params.currency,
            value: params.value,
            tax: params.tax,
            plan_id: params.planId,
            billing_period: params.billingPeriod,
            billing_reason: params.billingReason,
            items: [
              {
                item_id: params.planId,
                item_name: `Nailfolio ${params.planId} (${params.billingPeriod})`,
                item_category: 'subscription',
                price: params.value,
                quantity: 1,
              },
            ],
          },
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      await fetch(
        `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Analityka nigdy nie może dotknąć realizacji płatności. Cisza jest tu
    // właściwą reakcją: zgubione zdarzenie kosztuje wiersz w raporcie,
    // rzucony wyjątek kosztowałby potwierdzenie webhooka.
  }
}
