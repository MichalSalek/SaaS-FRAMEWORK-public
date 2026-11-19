import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { isOutOfScopeSession } from './stripe-webhooks.utils';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';

const meta = (m: Record<string, string> | null): Stripe.Metadata | null =>
  m as Stripe.Metadata | null;

describe('isOutOfScopeSession — guard sesji Stripe spoza zakresu aplikacji', () => {
  it('sesja z nie naszym projectId → skip (brak alertu)', () => {
    expect(isOutOfScopeSession(meta({ projectId: 'out-of-scope' }))).toBe(true);
  });

  it('dowolny inny nie nasz projectId → skip', () => {
    expect(isOutOfScopeSession(meta({ projectId: 'unscoped-value' }))).toBe(
      true
    );
  });

  it('nasza sesja (projectId = STRIPE_PROJECT_ID) → przetwarzaj', () => {
    expect(isOutOfScopeSession(meta({ projectId: STRIPE_PROJECT_ID }))).toBe(
      false
    );
  });

  it('WARIANT ZAOSTRZONY: sesja bez projectId (niestemplowana) → skip (zero legacy sesji nailfolio, owner-confirmed)', () => {
    // A session without our stamp (foreign BV without projectId / dashboard payment link / manual invoice).
    expect(
      isOutOfScopeSession(meta({ userEmail: 'stylist@example.com' }))
    ).toBe(true);
    // Pusta metadata.
    expect(isOutOfScopeSession(meta({}))).toBe(true);
    // Brak metadata w ogóle.
    expect(isOutOfScopeSession(meta(null))).toBe(true);
  });
});
