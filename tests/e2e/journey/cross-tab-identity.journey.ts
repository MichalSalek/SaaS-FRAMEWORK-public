// Two real stylist sessions against the isolated journey stack. No production credentials or APIs.
// The second tab's Storage object is written and the first tab's draft is blurred in ONE JS task:
// the receiving document's storage event cannot run between those two operations.
import { randomBytes } from 'node:crypto';
import { devices, expect, test, type Page } from '@playwright/test';
import { FakeCloudinary, installBoundaries } from './boundaries';
import { readMagicLink } from './mail-sink';

const run = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const emailA = `identity-a-${run}@e2e.test`;
const emailB = `identity-b-${run}@e2e.test`;
const bioA = `A saved ${run}`;
const bioB = `B saved ${run}`;
const privateDraft = `A unsaved ${run}`;

async function createStylist(page: Page, email: string): Promise<string> {
  await page.goto('/user/login/');
  await page.getByRole('button', { name: 'Tylko niezbędne' }).click();
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByRole('button', { name: 'Kontynuuj' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sprawdź pocztę' })
  ).toBeVisible();
  const mail = await readMagicLink(email);
  await page.goto(mail.url);
  await expect(page).toHaveURL(/\/app\/onboarding\/?/);
  await page.getByRole('radio', { name: /Jestem stylistką/ }).click();
  await page.getByRole('button', { name: 'Zaczynam' }).click();
  await expect(
    page.getByRole('heading', { name: 'Konto jest gotowe' })
  ).toBeVisible();
  const token = await page.evaluate(() =>
    localStorage.getItem('authorization')
  );
  if (!token)
    throw new Error('Isolated stylist login did not provide a session token');
  return token;
}

async function saveBio(page: Page, value: string): Promise<void> {
  await page.goto('/app/profile/');
  const field = page.getByRole('textbox', { name: 'Bio', exact: true });
  await expect(field).toBeEnabled();
  await field.fill(value);
  const response = page.waitForResponse(
    result =>
      result.url().includes('/api/v1/account/update-stylist-profile') &&
      result.request().method() === 'POST'
  );
  await field.blur();
  expect((await response).ok()).toBe(true);
  await expect(field).toHaveValue(value);
}

test('a cross-tab bearer replacement cannot publish the old account draft', async ({
  browser,
  baseURL,
}) => {
  const { defaultBrowserType: _engine, ...phone } = devices['Pixel 7'];
  const options = {
    ...phone,
    ...(baseURL ? { baseURL } : {}),
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
  };
  const fake = new FakeCloudinary('');
  const contextA = await browser.newContext(options);
  const contextB = await browser.newContext(options);
  await installBoundaries(contextA, fake);
  await installBoundaries(contextB, fake);
  const pageA = await contextA.newPage();
  const sourceB = await contextB.newPage();
  try {
    const tokenA = await createStylist(pageA, emailA);
    await saveBio(pageA, bioA);
    const tokenB = await createStylist(sourceB, emailB);
    await saveBio(sourceB, bioB);
    expect(tokenA !== tokenB).toBe(true);

    const popup = pageA.waitForEvent('popup');
    await pageA.evaluate(() => {
      const host = window as Window & { __identityWriter?: Window | null };
      host.__identityWriter = window.open(
        '/app/profile/',
        'identity-race-writer'
      );
    });
    const writer = await popup;
    await writer.waitForLoadState('domcontentloaded');
    await expect(
      writer.getByRole('textbox', { name: 'Bio', exact: true })
    ).toHaveValue(bioA);

    let sentDraftWithNewToken = false;
    let sentDraftAtAll = false;
    pageA.on('request', request => {
      if (!request.url().includes('/api/v1/account/update-stylist-profile'))
        return;
      if (!(request.postData() ?? '').includes(privateDraft)) return;
      sentDraftAtAll = true;
      sentDraftWithNewToken =
        request.headers()['authorization'] === `Bearer ${tokenB}`;
    });
    const fieldA = pageA.getByRole('textbox', { name: 'Bio', exact: true });
    await expect(fieldA).toHaveValue(bioA);
    await fieldA.fill(privateDraft);
    await pageA.evaluate(() => {
      const host = window as Window & { __identityStorageEvents?: number };
      host.__identityStorageEvents = 0;
      window.addEventListener(
        'storage',
        event => {
          if (event.key === 'authorization')
            host.__identityStorageEvents =
              (host.__identityStorageEvents ?? 0) + 1;
        },
        true
      );
      window.addEventListener(
        'nf:auth-identity-will-change',
        () => {
          sessionStorage.setItem('e2e:identity-teardown-observed', 'yes');
        },
        { once: true }
      );
    });

    const reloaded = pageA.waitForEvent(
      'framenavigated',
      frame => frame === pageA.mainFrame()
    );
    const result = await pageA.evaluate(token => {
      const host = window as Window & {
        __identityWriter?: Window | null;
        __identityStorageEvents?: number;
      };
      const other = host.__identityWriter;
      const field = document.activeElement;
      if (!other || !(field instanceof HTMLTextAreaElement))
        throw new Error('Race fixture was not armed');
      other.localStorage.setItem('authorization', token);
      const beforeStorageEvent = host.__identityStorageEvents === 0;
      const newBearerVisible = localStorage.getItem('authorization') === token;
      field.blur();
      return { beforeStorageEvent, newBearerVisible };
    }, tokenB);
    expect(result).toEqual({
      beforeStorageEvent: true,
      newBearerVisible: true,
    });
    await reloaded;
    await expect(
      pageA.getByRole('textbox', { name: 'Bio', exact: true })
    ).toHaveValue(bioB);
    expect(
      await pageA.evaluate(() =>
        sessionStorage.getItem('e2e:identity-teardown-observed')
      )
    ).toBe('yes');
    expect(
      await pageA.evaluate(
        token => localStorage.getItem('authorization') === token,
        tokenB
      )
    ).toBe(true);
    expect(sentDraftWithNewToken).toBe(false);
    expect(sentDraftAtAll).toBe(false);
    // Real B account state on the backend remains B's, not A's uncommitted text.
    await sourceB.reload();
    await expect(
      sourceB.getByRole('textbox', { name: 'Bio', exact: true })
    ).toHaveValue(bioB);
    expect(fake.blocked).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
