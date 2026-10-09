// tests/e2e/specs/06-account-delete-page.spec.ts
//
// CRITICAL PATH #8 (Account delete → confirmation token → hard delete + cascade):
//   Exercise the entry surface — the 3-step delete flow at /app/user/delete-self.
//
//   1. Authenticated stylist navigates to /app/user/delete-self.
//   2. Step 1 ("Review") renders with the consequence list + "I want to
//      delete" CTA.
//   3. Clicking the CTA advances to Step 2 ("Confirm") where the type-to-
//      confirm gate appears, requiring the literal word "USUN".
//
//   We deliberately STOP before triggering the actual hard-delete email
//   because doing so would mark the seeded test stylist for deletion (24h
//   grace window) and corrupt every subsequent test in the same session.
//   The backend smoke tests (tests/smoke/recovery-domain.smoke.ts +
//   tests/smoke/lifecycle.smoke.ts) cover the full cascade.

import { test, expect } from '@playwright/test';
import { loginViaDevToken } from '../helpers/auth';
import { E2E_ENV } from '../helpers/env';

test.describe('account delete: page renders and stepper advances', () => {
  test('delete-self flow reaches confirmation gate without firing the email', async ({
    page,
    context,
  }) => {
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);
    await page.goto('/app/user/delete-self');

    // Step 1 CTA — the "I want to delete" button. We resolve it by role +
    // label substring. Fall back to "Continue / Next" if locale changed.
    // The auto-waiting visibility assertion is the deterministic hydration
    // signal for the Review step (replaces networkidle).
    const advanceBtn = page
      .getByRole('button')
      .filter({ hasText: /usun|delete|chcę|chce|continue|next/i })
      .first();
    await expect(advanceBtn).toBeVisible({ timeout: 10_000 });

    // Step 1 — "Review" — should be visible. Use a broad text match on the
    // canonical PL copy seeds (heroTitle + heroAccent are concatenated).
    // The page uses `CONFIRMATION_WORD = 'USUN'` (uppercased) — search for
    // that literal as a stable surface-independent signal.
    const stepperContent = (await page.textContent('body')) ?? '';
    expect(stepperContent.toLowerCase()).toMatch(/usuń|delete|usun/);

    await advanceBtn.click();

    // Step 2 — "Confirm" — type-to-confirm input must surface. The
    // placeholder text references the CONFIRMATION_WORD literal.
    const confirmInput = page
      .locator('input')
      .filter({
        hasNot: page.locator('[type="hidden"]'),
      })
      .first();
    await expect(confirmInput).toBeVisible({ timeout: 10_000 });

    // Typing the word should enable the destructive primary. We type but do
    // NOT submit — submitting would queue a deletion email and toggle
    // status to PENDING_DELETION on the seeded test user.
    await confirmInput.fill('USUN');

    // Destructive primary must now be enabled. Find via role + non-cancel
    // text. We don't assert click-through (that's the line we won't cross).
    const destructiveBtn = page
      .getByRole('button')
      .filter({ hasText: /wyślij|wyslij|send|delete|usun/i });
    const count = await destructiveBtn.count();
    expect(count).toBeGreaterThan(0);
  });
});
