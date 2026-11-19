import {
  EMAIL_LIFECYCLE_CONFIG,
  EMAIL_SWEEP_TUNING,
} from '@kernel/domain/email/email-schedule.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import {
  queryTrialAccounts,
  buildTrialSweepContext,
  type TrialSweepResult,
} from './trial-sweep.query';
export {
  queryTrialAccounts,
  buildTrialSweepContext,
} from './trial-sweep.query';
import { processTrialAccount } from './trial-account.send';

export const sendTrialEmails_IO = async (
  sweepId?: string
): Promise<TrialSweepResult> => {
  const now = new Date();
  const pageSize = EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP;
  let afterAccountId: string | null = null;
  let emailsSent = 0;
  let accountsProcessed = 0;

  // Pages instead of one take: an account that already got its due email
  // still matches the query for the rest of its catch-up window, so a single
  // oldest-first page could be all already-served rows while newer trials
  // (waiting for the welcome) never made it in. The send cap still bounds
  // one sweep; the page cap bounds the scan.
  for (let page = 0; page < EMAIL_SWEEP_TUNING.MAX_SWEEP_PAGES; page += 1) {
    const accounts = await queryTrialAccounts(now, afterAccountId);
    if (accounts.length === 0) {
      return { emailsSent, accountsProcessed };
    }

    const context = await buildTrialSweepContext(accounts);
    const perAccountSent = await runWithConcurrency(
      accounts,
      EMAIL_LIFECYCLE_CONFIG.SWEEP_CONCURRENCY,
      account => processTrialAccount(account, context, sweepId)
    );
    emailsSent += perAccountSent.reduce((sum, count) => sum + count, 0);
    accountsProcessed += accounts.length;

    const lastAccount = accounts[accounts.length - 1];
    if (accounts.length < pageSize || lastAccount === undefined) {
      return { emailsSent, accountsProcessed };
    }
    if (emailsSent >= pageSize) {
      break;
    }
    afterAccountId = lastAccount.account_id;
  }

  // Cap-hit observability, parity with the other sweeps: the trial sequence
  // is the main conversion funnel, so a sweep that stopped before the end of
  // the due audience must be visible. The rest waits for the next sweep.
  reportIssueBackend({
    namespace: 'TRIAL_EMAIL_SWEEP_CAP_HIT',
    message: `Trial-email sweep stopped at ${emailsSent} sent / ${accountsProcessed} accounts scanned (caps: ${pageSize} sends, ${EMAIL_SWEEP_TUNING.MAX_SWEEP_PAGES} pages); the rest is deferred to the next sweep`,
    payload: {},
    mode: 'warn',
  });
  return { emailsSent, accountsProcessed };
};
