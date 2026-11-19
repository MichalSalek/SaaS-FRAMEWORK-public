import { z } from 'zod';

/**
 * DECISION: a timestamp is an ISO string on the wire. Handlers may still return a Prisma `Date`;
 * `JSON.stringify` turns it into that string before the response check, and `defineEndpoint` accepts
 * either. The client type is the string. Typing it as `Date` is a lie after `JSON.parse` (a screen
 * that called `.getTime()` on `trial_ends_at` crashed the stylist panel).
 */
const isoInstant = z
  .string()
  .refine(
    value => !Number.isNaN(Date.parse(value)),
    'Expected an ISO timestamp'
  );

export const wireInstant = z
  .union([isoInstant, z.date()])
  .transform((value): string =>
    value instanceof Date ? value.toISOString() : value
  );
