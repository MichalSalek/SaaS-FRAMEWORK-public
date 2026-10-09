/**
 * Guard sesji Stripe spoza zakresu aplikacji.
 *
 * Nie zakładamy, że sesja na koncie Stripe należy do tej aplikacji. Bez guardu
 * webhook nie znajduje stylistki dla sesji bez naszego stempla i emituje FAŁSZYWY
 * critical alert "Checkout Completed But No Stylist Account Found".
 *
 * `isOutOfScopeSession` to predykat, na którym stoi skip w routerze
 * (`stripe-event-router.ts` case CHECKOUT_SESSION_COMPLETED → nie nasza ⇒ ACK 200,
 * info log, `{ effects: [] }`, ZERO alertu). Test pokrywa wariant ZAOSTRZONY
 * (2026-07-18, owner-confirmed brak legacy): TYLKO projectId === 'nailfolio' ⇒
 * nasza; wszystko inne (także undefined) ⇒ skip — genuine sesje nailfolio
 * zawsze mają stempel, więc odsiewane są tylko niestemplowane.
 */

import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { isOutOfScopeSession } from './stripe-webhooks.utils';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';

const meta = (m: Record<string, string> | null): Stripe.Metadata | null =>
  m as Stripe.Metadata | null;

describe('isOutOfScopeSession — guard sesji Stripe spoza zakresu aplikacji', () => {
  it('sesja z nie naszym projectId → skip (brak alertu)', () => {
    expect(isOutOfScopeSession(meta({ projectId: 'out-of-scope' }))).toBe(
      true
    );
  });

  it('dowolny inny nie nasz projectId → skip', () => {
    expect(isOutOfScopeSession(meta({ projectId: 'unscoped-value' }))).toBe(
      true
    );
  });

  it('nasza sesja (projectId = STRIPE_PROJECT_ID) → przetwarzaj', () => {
    expect(
      isOutOfScopeSession(meta({ projectId: STRIPE_PROJECT_ID }))
    ).toBe(false);
  });

  it('WARIANT ZAOSTRZONY: sesja bez projectId (niestemplowana) → skip (zero legacy sesji nailfolio, owner-confirmed)', () => {
    // Sesja bez naszego stempla (bez projectId / dashboard payment-link / ręczne invoice).
    expect(
      isOutOfScopeSession(meta({ userEmail: 'stylist@example.com' }))
    ).toBe(true);
    // Pusta metadata.
    expect(isOutOfScopeSession(meta({}))).toBe(true);
    // Brak metadata w ogóle.
    expect(isOutOfScopeSession(meta(null))).toBe(true);
  });
});
