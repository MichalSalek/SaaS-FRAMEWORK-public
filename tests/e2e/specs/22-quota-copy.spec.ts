import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { loginViaDevToken } from '../helpers/auth';
import { dismissCookieBanner } from '../helpers/ui';
import { E2E_ENV } from '../helpers/env';
import {
  ROUTES_FRONT,
  ROUTES_API,
} from '../../../.shared-kernel/domain/routing/routing.config';
import { PricingPlanValue } from '../../../.shared-kernel/domain/pricing/pricing.config';

async function usageAt(page: Page, count: number) {
  await page.route(`**${ROUTES_API.USER_GET_USAGE_STATS}*`, async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const body = await response.json();
    body.data.gallery_records = count;
    body.data.limits.max_gallery_records = 5;
    await route.fulfill({ response, json: body });
  });
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: 'nf_internal', value: '1', domain: 'localhost', path: '/' },
  ]);
  await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);
});

test('Ostatnie miejsce jest spokojną informacją bez okna zmiany planu', async ({
  page,
}) => {
  await usageAt(page, 4);
  await page.goto(ROUTES_FRONT.GALLERY_UPLOAD_ASSET);
  await dismissCookieBanner(page);
  const picker = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Wybierz zdjęcie z telefonu' })
    .click();
  await (
    await picker
  ).setFiles(resolve('main/public/img/lp/hero/hero-nail-17-glazed-knit.webp'));
  await page.getByRole('button', { name: 'Zatwierdź kadr' }).click();
  await page.getByRole('button', { name: 'Różowe', exact: true }).click();
  await page.getByRole('button', { name: 'French', exact: true }).click();
  await page.getByRole('button', { name: 'Krótkie', exact: true }).click();
  await page.getByRole('button', { name: 'Dalej', exact: true }).click();
  await expect(
    page.getByText('Możesz dodać jeszcze jedno zdjęcie', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Zmień plan', exact: true })
  ).toHaveCount(0);
  await page.locator('main').evaluate(async element => {
    await Promise.allSettled(
      element
        .getAnimations({ subtree: true })
        .filter(
          animation => animation.effect?.getTiming().iterations !== Infinity
        )
        .map(animation => animation.finished)
    );
  });
  await page.screenshot({
    path: '.playwright-mcp/entry-copy-review/limit-one-left.png',
  });
});

test('Próba dodania po limicie prowadzi do właściwego planu bez drugiego upsellu', async ({
  page,
}) => {
  await usageAt(page, 5);
  await page.goto(ROUTES_FRONT.GALLERY_UPLOAD_ASSET);
  await dismissCookieBanner(page);
  await expect(
    page.getByRole('heading', { name: 'Powiększ swoją galerię' })
  ).toBeVisible();
  const upgrade = page.getByRole('link', {
    name: 'Zobacz plan Pro',
    exact: true,
  });
  await expect(upgrade).toBeVisible();
  const href = new URL(
    (await upgrade.getAttribute('href')) ?? '',
    E2E_ENV.FRONTEND_URL
  );
  expect(href.pathname.replace(/\/$/, '')).toBe(ROUTES_FRONT.USER_ACCOUNT_PAY);
  expect(href.searchParams.get('planId')).toBe(PricingPlanValue.PRO);
  expect(href.searchParams.get('billingPeriod')).toBe('month');
  await expect(
    page.getByRole('dialog', { name: 'Zmień plan', exact: true })
  ).toHaveCount(0);
  await page.screenshot({
    path: '.playwright-mcp/entry-copy-review/limit-wall.png',
  });
  await page
    .getByRole('button', { name: 'Wróć do galerii', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/gallery\/?$/);
});

test('Brak danych o zużyciu nie jest przedstawiany jako osiągnięty limit', async ({
  page,
}) => {
  await page.route(`**${ROUTES_API.USER_GET_USAGE_STATS}*`, route =>
    route.fulfill({ status: 503, json: { error: 'QA unavailable' } })
  );
  await page.goto(ROUTES_FRONT.GALLERY_UPLOAD_ASSET);
  await dismissCookieBanner(page);
  await expect(
    page.getByRole('heading', { name: 'Powiększ swoją galerię' })
  ).toHaveCount(0);
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await expect(page.locator('[data-quota-state]')).toHaveCount(0);
});
