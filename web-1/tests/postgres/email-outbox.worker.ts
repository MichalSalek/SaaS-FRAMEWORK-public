// A separate OS process for tests/postgres/email-outbox.test.ts, killed with SIGKILL mid-way:
//   enqueue <userId> <accountId> <occurrence>        commit an intent, print COMMITTED, hang
//   send <provider> <behavior> <messageId>           run one outbox round over that message with the
//                                                    fake provider; print REACHED when it is reached
// Runs the PRODUCTION store (enqueue, claim, fences) against the test schema.
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/prisma/js-client/index.js';
import {
  enqueueEmailOutboxTx,
  runEmailOutboxRound,
} from '../../src/application/email-handler/outbox/email-outbox.store';
import { fakeDeps, type ProviderBehavior } from './email-outbox.fakes';

const [mode, a, b, c] = process.argv.slice(2);
const url = process.env.OUTBOX_WORKER_URL;
const schema = process.env.OUTBOX_WORKER_SCHEMA;
if (!url || !schema || !mode || !a || !b) {
  throw new Error('worker: missing arguments');
}
const pool = new Pool({
  connectionString: url,
  options: `-c search_path=${schema},public`,
  max: 4,
});
const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
const hang = () => new Promise(() => undefined);

const main = async (): Promise<void> => {
  if (mode === 'enqueue') {
    await db.$transaction(async tx => {
      await enqueueEmailOutboxTx(tx, {
        userId: a,
        accountId: b,
        ruleId: 'payment-failed',
        templateId: 'payment-failed',
        occurrence: c ?? 'invoice:worker:attempt:1',
        subjectKey: 'email.paymentFailed.subject',
        infoEvent: 'EMAIL_PAYMENT_FAILED_SENT',
        vars: { planName: 'Pro' },
      });
    });
    process.stdout.write('COMMITTED\n');
    await hang();
  }
  if (mode === 'send') {
    const provider = a === 'mailgun' ? 'mailgun' : 'resend';
    const behavior = b as ProviderBehavior;
    await runEmailOutboxRound(
      fakeDeps({
        db,
        pool,
        schema,
        provider,
        behavior: () => behavior,
        onProviderReached: () => process.stdout.write('REACHED\n'),
      }),
      c ? { ids: [c] } : {}
    );
    process.stdout.write('ROUND_DONE\n');
    await hang();
  }
};

void main();
