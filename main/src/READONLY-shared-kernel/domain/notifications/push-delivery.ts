import { z } from 'zod';

export const pushDispatchSummarySchema = z.object({
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  gone: z.number().int().nonnegative(),
  skipped: z
    .enum([
      'no-devices',
      'notifications-disabled',
      'provider-unconfigured',
      'lookup-failed',
      'dispatch-failed',
    ])
    .nullable(),
});

/** Transport acceptance is not proof of display on the recipient's phone. */
export type PushDispatchSummary = z.infer<typeof pushDispatchSummarySchema>;
