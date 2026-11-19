// tests/e2e/journey/stylist-client.journey.ts
//
// The nightly user journey, entirely through the UI of production builds:
//   1. a new stylist logs in with the link read from the mail sink and finishes onboarding;
//   2. she chooses a file, crops it, describes it and publishes it (upload through the fake
//      Cloudinary boundary, the record saved by the real backend into the disposable database);
//   3. the photo is in her gallery, drawn from the (fake) CDN address the backend stored;
//   4. a new client logs in the same way, opens the stylist's profile from the QR link and asks to
//      connect; the stylist accepts in her own session; the client then sees the full gallery with
//      the photo.
// Boundaries replaced: see boundaries.ts and mail-sink.ts. Runbook: README.md next to this file.
//
// E2E_BREAK=<step> sabotages one boundary on purpose (mail | upload | save | pair | mobile) to prove
// the step turns the run red; the nightly never sets it.

import { randomBytes } from 'node:crypto';
import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { FakeCloudinary, installBoundaries } from './boundaries';
import { readMagicLink } from './mail-sink';

const BREAK = process.env['E2E_BREAK'] ?? '';
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const STYLIST_EMAIL = `stylist-${RUN}@e2e.test`;
const CLIENT_EMAIL = `client-${RUN}@e2e.test`;
// Digits only after a capitalised word: the app title-cases the name a client types.
const CLIENT_NAME = `Ola Klientka ${Date.now() % 1_000_000}`;
const FIXTURE = 'tests/e2e/journey/fixtures/nail-photo.jpg';

type MobileApiFailure = {
  role: string;
  method: string;
  path: string;
  status?: number;
  reason?: string;
};

/**
 * Observe the backend's real per-IP request budget across cold navigations.
 * The response headers are the source of truth; do not change the production limiter for QA.
 */
class MobileReviewApiMonitor {
  private readonly budgets = new Map<number, number>();
  private collectingFailures = false;
  readonly failures: MobileApiFailure[] = [];
  readonly cancellations: MobileApiFailure[] = [];

  observe(page: Page, role: string): void {
    page.on('response', response => {
      const url = new URL(response.url());
      if (!this.isLocalApi(url)) return;

      const headers = response.headers();
      const remaining = Number(headers['x-ratelimit-remaining']);
      const resetSeconds = Number(headers['x-ratelimit-reset']);
      if (Number.isFinite(remaining) && Number.isFinite(resetSeconds)) {
        const resetAt = resetSeconds * 1000;
        this.budgets.set(
          resetAt,
          Math.min(this.budgets.get(resetAt) ?? remaining, remaining)
        );
      }

      if (this.collectingFailures && response.status() >= 400) {
        this.failures.push({
          role,
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
      }
    });

    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (!this.collectingFailures || !this.isLocalApi(url)) return;
      const reason = request.failure()?.errorText;
      const record: MobileApiFailure = {
        role,
        method: request.method(),
        path: url.pathname,
        ...(reason ? { reason } : {}),
      };
      if (reason === 'net::ERR_ABORTED') {
        this.cancellations.push(record);
      } else {
        this.failures.push(record);
      }
    });
  }

  startFailureCollection(): void {
    this.collectingFailures = true;
  }

  async waitForHeadroom(page: Page): Promise<void> {
    const now = Date.now();
    for (const resetAt of this.budgets.keys()) {
      if (resetAt <= now) this.budgets.delete(resetAt);
    }

    // Backend RATE_LIMIT_CONFIG is 100 requests / 10 seconds for ordinary routes and 50 / 10
    // seconds for strict paths. Keep 40 requests of headroom from the observed bucket before a
    // cold navigation, which lets the next screen fetch its real data without approaching either
    // limit. X-RateLimit-Reset is the server-supplied epoch (rounded up to seconds).
    const lowBudgets = [...this.budgets.entries()].filter(
      ([, remaining]) => remaining < 40
    );
    if (lowBudgets.length === 0) return;

    const resetAt = Math.max(...lowBudgets.map(([windowReset]) => windowReset));
    const waitMs = resetAt - Date.now() + 100;
    if (waitMs <= 0) return;
    if (waitMs > 12_000) {
      throw new Error(
        `Rate-limit reset header is outside the expected 10-second window (${waitMs}ms)`
      );
    }
    await page.waitForTimeout(waitMs);
    for (const windowReset of this.budgets.keys()) {
      if (windowReset <= Date.now()) this.budgets.delete(windowReset);
    }
  }

  failuresSince(index: number): MobileApiFailure[] {
    return this.failures.slice(index);
  }

  private isLocalApi(url: URL): boolean {
    return (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.pathname.startsWith('/api/')
    );
  }
}

const POLISH_LOAD_ERROR =
  /(?:nie udało się (?:wczytać|załadować|pobrać)|nie powiodło się (?:wczytać|załadować|pobrać)|wystąpił (?:nieoczekiwany )?błąd|błąd (?:wczytywania|ładowania|pobierania)|brak połączenia (?:z )?(?:serwerem|internetem)|spróbuj ponownie)/i;

async function loginThroughMail(page: Page, email: string): Promise<void> {
  await page.goto('/user/login/');
  // Fresh context: the consent banner overlays the form on a phone. A real user answers it first.
  await page.getByRole('button', { name: 'Tylko niezbędne' }).click();
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByRole('button', { name: 'Kontynuuj' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sprawdź pocztę' })
  ).toBeVisible();

  const mail = await readMagicLink(email);
  expect(mail.subject).toBe('Zaloguj się do Nailfolio');
  const link = new URL(mail.url);
  if (BREAK === 'mail') {
    link.searchParams.set('token', 'e2e-break-not-a-token');
  }
  // Same browser that asked for the link (LOGIN_STARTED_AT marker), so no confirmation screen.
  await page.goto(link.toString());
  await expect(page).toHaveURL(/\/app\/onboarding\/?/);
}

async function chooseRole(page: Page, role: RegExp): Promise<void> {
  await page.getByRole('radio', { name: role }).click();
  await page.getByRole('button', { name: 'Zaczynam' }).click();
  await expect(
    page.getByRole('heading', { name: 'Konto jest gotowe' })
  ).toBeVisible();
}

test.describe('nightly journey: login from mail, upload a photo, pair two users', () => {
  test('stylist publishes a photo, client asks to connect, stylist accepts', async ({
    browser,
    baseURL,
  }, testInfo) => {
    // Two users = two independent browser contexts (own storage, own bearer token), created inside
    // the test so the config's `trace: 'retain-on-failure'` records both (kept only for a red run).
    const { defaultBrowserType: _engine, ...phone } = devices['Pixel 7'];
    const options = {
      ...phone,
      ...(baseURL ? { baseURL } : {}),
      locale: 'pl-PL',
      timezoneId: 'Europe/Warsaw',
    };
    const fake = new FakeCloudinary(BREAK);
    const stylistContext: BrowserContext = await browser.newContext(options);
    const clientContext: BrowserContext = await browser.newContext(options);
    await installBoundaries(stylistContext, fake);
    await installBoundaries(clientContext, fake);
    const stylist = await stylistContext.newPage();
    const client = await clientContext.newPage();
    const mobileReviewApi = new MobileReviewApiMonitor();
    mobileReviewApi.observe(stylist, 'stylist');
    mobileReviewApi.observe(client, 'client');
    const shoot = async (page: Page, name: string): Promise<void> => {
      await testInfo.attach(name, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    };

    try {
      await test.step('stylist: login with the link from the mail sink, onboarding as stylist', async () => {
        await loginThroughMail(stylist, STYLIST_EMAIL);
        await chooseRole(stylist, /Jestem stylistką/);
      });

      await test.step('stylist: choose a file, crop, describe, publish', async () => {
        await stylist
          .getByRole('button', { name: 'Dodaj pierwsze zdjęcie' })
          .click();
        await expect(stylist).toHaveURL(/\/app\/gallery\/upload-asset\/?/);
        const chooser = stylist.waitForEvent('filechooser');
        await stylist
          .getByRole('button', { name: 'Wybierz zdjęcie z telefonu' })
          .click();
        await (await chooser).setFiles(FIXTURE);
        await expect(
          stylist.getByRole('heading', { name: 'Przytnij zdjęcie' })
        ).toBeVisible();
        await stylist.getByRole('button', { name: 'Zatwierdź kadr' }).click();

        await expect(
          stylist.getByRole('heading', {
            name: 'Uzupełnij szczegóły stylizacji',
          })
        ).toBeVisible();
        await stylist
          .getByRole('button', { name: 'Różowe', exact: true })
          .click();
        await stylist
          .getByRole('button', { name: 'French', exact: true })
          .click();
        await stylist
          .getByRole('button', { name: 'Krótkie', exact: true })
          .click();
        await stylist.getByRole('button', { name: 'Dalej' }).click();

        await expect(
          stylist.getByRole('heading', { name: 'Sprawdź szczegóły' })
        ).toBeVisible();
        const saved = stylist
          .waitForResponse(
            r =>
              r.url().includes('/api/v1/gallery/create-gallery-record') &&
              r.request().method() === 'POST'
          )
          .catch(() => null);
        await stylist
          .getByRole('button', { name: 'Opublikuj zdjęcie' })
          .click();
        await expect
          .poll(() => fake.attempts.length, {
            message: 'the app never reached the Cloudinary upload boundary',
          })
          .toBeGreaterThan(0);
        expect(
          fake.attempts,
          'the upload request broke the Cloudinary contract (or E2E_BREAK=upload)'
        ).toEqual([{ accepted: true }]);
        const response = await saved;
        expect(
          response?.status(),
          'gallery create (the save of the uploaded photo)'
        ).toBe(201);
        await expect(
          stylist.getByRole('heading', { name: 'Dodałaś pierwsze zdjęcie' })
        ).toBeVisible();
      });

      await test.step('stylist: the photo is in her gallery, drawn from the stored CDN address', async () => {
        await stylist
          .getByRole('button', { name: 'Przejdź do galerii' })
          .click();
        await expect(
          stylist.getByRole('heading', { name: 'Twoja galeria', level: 1 })
        ).toBeVisible();
        const publicId = fake.uploads[0]?.publicId ?? '';
        const photo = stylist.locator(`main img[src*="${publicId}"]`).first();
        await expect(photo).toBeVisible();
        await expect
          .poll(() =>
            photo.evaluate(img => (img as HTMLImageElement).naturalWidth)
          )
          .toBeGreaterThan(0);
        await shoot(stylist, 'stylist-gallery');
      });

      let profilePath = '';
      await test.step('stylist: read her public profile link (what the QR code encodes)', async () => {
        await stylist.goto('/app/profile/');
        const link = stylist.getByRole('link', { name: 'Zobacz profil' });
        await expect(link).toHaveAttribute('href', /^\/stylist\/[^/]+\/?$/);
        profilePath = (await link.getAttribute('href')) ?? '';
      });

      await test.step('client: login with the link from the mail sink, onboarding as client', async () => {
        await loginThroughMail(client, CLIENT_EMAIL);
        await chooseRole(client, /Jestem klientką/);
      });

      let threadPath = '';
      await test.step('client: contact can return to the profile and open a connection confirmation', async () => {
        const pairRequests: string[] = [];
        const observe = (request: import('@playwright/test').Request) => {
          if (
            request.method() === 'POST' &&
            request.url().includes('/pairing/request-pair')
          ) {
            pairRequests.push(request.url());
          }
        };
        client.on('request', observe);
        await client.goto(profilePath);
        await client
          .getByRole('button', { name: 'Napisz wiadomość', exact: true })
          .click();
        await expect(client).toHaveURL(/\/app\/messages\/[^/?]+/);
        threadPath = new URL(client.url()).pathname;
        await client
          .getByRole('textbox', { name: 'Napisz wiadomość...' })
          .fill('Czy wykonuje Pani tę stylizację?');
        await client
          .getByRole('button', { name: 'Wyślij wiadomość', exact: true })
          .click();
        await expect(
          client.getByText('Czy wykonuje Pani tę stylizację?', { exact: true })
        ).toBeVisible();
        await client.getByRole('link', { name: /^Zobacz profil:/ }).click();
        await expect(client).toHaveURL(/\/stylist\/[^/?]+\/?$/);
        await expect(
          client.getByRole('dialog', { name: 'Prośba o połączenie' })
        ).toBeHidden();
        await client.goto(threadPath);
        const conversationHeader = client.locator('header').filter({
          has: client.getByRole('link', { name: /^Zobacz profil:/ }),
        });
        await conversationHeader
          .getByRole('button', { name: 'Więcej', exact: true })
          .click();
        await client
          .getByRole('menuitem', { name: 'Poproś o połączenie', exact: true })
          .click();
        const confirmation = client.getByRole('dialog', {
          name: 'Prośba o połączenie',
        });
        await expect(confirmation).toBeVisible();
        expect(pairRequests).toHaveLength(0);
        await confirmation
          .getByRole('button', { name: 'Anuluj', exact: true })
          .last()
          .click();
        await expect(confirmation).toBeHidden();
        expect(pairRequests).toHaveLength(0);
        client.off('request', observe);
      });

      await test.step('client: open the profile from the QR link and ask to connect', async () => {
        let requestsSent = 0;
        client.on('request', request => {
          if (
            request.method() === 'POST' &&
            request.url().includes('/pairing/request-pair')
          ) {
            requestsSent += 1;
          }
        });
        await client.goto(`${profilePath}?from=qr`);
        const stylistName = await client
          .getByRole('heading', { level: 1 })
          .first()
          .innerText();
        await client
          .getByRole('button', { name: 'Poproś o połączenie' })
          .click();
        const dialog = client.getByRole('dialog', {
          name: 'Prośba o połączenie',
        });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(stylistName);
        await dialog
          .getByRole('button', { name: 'Anuluj', exact: true })
          .last()
          .click();
        await expect(dialog).toBeHidden();
        expect(requestsSent).toBe(0);
        await client
          .getByRole('button', { name: 'Poproś o połączenie' })
          .click();
        await dialog
          .getByRole('textbox', { name: 'Twoje imię' })
          .fill(CLIENT_NAME);
        await expect(
          dialog.getByRole('textbox', { name: 'Miejscowość' })
        ).toHaveCount(0);
        await dialog
          .getByRole('textbox', { name: 'Opcjonalna wiadomość' })
          .fill('Chciałabym zobaczyć więcej Twoich prac');
        await dialog
          .getByRole('button', { name: 'Wyślij prośbę o połączenie' })
          .click();
        const sentStatus = client
          .getByRole('status')
          .filter({ hasText: 'Wysłałaś prośbę o połączenie' })
          .first();
        await expect(sentStatus).toBeVisible();
        await expect(sentStatus).toContainText(stylistName);
        expect(requestsSent).toBe(1);
      });

      await test.step('client: withdraw a request, keep writing in the same conversation, and reassert', async () => {
        await mobileReviewApi.waitForHeadroom(client);
        await client
          .getByRole('button', { name: 'Anuluj prośbę', exact: true })
          .click();
        const withdrawal = client.getByRole('dialog', {
          name: 'Anulować prośbę o połączenie?',
        });
        await withdrawal
          .getByRole('button', { name: 'Anuluj prośbę', exact: true })
          .click();
        await expect(
          client.getByRole('button', {
            name: 'Poproś o połączenie',
            exact: true,
          })
        ).toBeVisible();
        await expect(
          client
            .getByRole('status')
            .filter({ hasText: 'Wysłałaś prośbę o połączenie' })
        ).toHaveCount(0);
        await mobileReviewApi.waitForHeadroom(client);
        await client.goto(threadPath);
        await expect(
          client.getByText('Czy wykonuje Pani tę stylizację?', { exact: true })
        ).toBeVisible();
        await client
          .getByRole('textbox', { name: 'Napisz wiadomość...' })
          .fill('Chętnie zobaczę też podobne prace.');
        await client
          .getByRole('button', { name: 'Wyślij wiadomość', exact: true })
          .click();
        await expect(
          client.getByText('Chętnie zobaczę też podobne prace.', {
            exact: true,
          })
        ).toBeVisible();
        await mobileReviewApi.waitForHeadroom(client);
        await client
          .locator('header')
          .filter({
            has: client.getByRole('link', { name: /^Zobacz profil:/ }),
          })
          .getByRole('button', { name: 'Więcej', exact: true })
          .click();
        await client
          .getByRole('menuitem', { name: 'Poproś o połączenie', exact: true })
          .click();
        const dialog = client.getByRole('dialog', {
          name: 'Prośba o połączenie',
        });
        await expect(
          dialog.getByRole('textbox', { name: 'Twoje imię' })
        ).toHaveValue(CLIENT_NAME);
        await dialog
          .getByRole('textbox', { name: 'Opcjonalna wiadomość' })
          .fill('Chciałabym zobaczyć więcej Twoich prac');
        await dialog
          .getByRole('button', { name: 'Wyślij prośbę o połączenie' })
          .click();
        await expect(
          client
            .getByText('Prośba czeka na akceptację', { exact: true })
            .first()
        ).toBeVisible();
      });

      await test.step('stylist: accept the request in her own session', async () => {
        if (BREAK === 'pair') {
          await stylist.route('**/api/v1/pairing/respond-request', route =>
            route.abort('failed')
          );
        }
        await stylist.goto('/app/clients/');
        const row = stylist
          .getByRole('listitem')
          .filter({ hasText: CLIENT_NAME });
        await expect(row).toContainText('Brak lokalizacji');
        await expect(row).toContainText(
          'Chciałabym zobaczyć więcej Twoich prac'
        );
        await row.getByRole('button', { name: 'Akceptuj' }).click();
        await expect(
          stylist.getByRole('list', { name: 'Połączone klientki' })
        ).toContainText(CLIENT_NAME);
        await shoot(stylist, 'stylist-clients');
      });

      await test.step('client: connected, sees the full gallery with the photo', async () => {
        await mobileReviewApi.waitForHeadroom(client);
        await client.goto(profilePath);
        await expect(
          client.getByText('Połączono', { exact: true })
        ).toBeVisible();
        await mobileReviewApi.waitForHeadroom(client);
        await client
          .getByRole('link', { name: 'Zobacz pełną galerię' })
          .click();
        const photo = client
          .locator(`main img[src*="${fake.uploads[0]?.publicId ?? ''}"]`)
          .first();
        await expect(photo).toBeVisible();
        await expect
          .poll(() =>
            photo.evaluate(img => (img as HTMLImageElement).naturalWidth)
          )
          .toBeGreaterThan(0);
        await shoot(client, 'client-gallery');
      });

      if (process.env['E2E_MOBILE_REVIEW'] === '1') {
        await test.step('mobile review: authenticated screens in both roles', async () => {
          await Promise.all([
            stylist.waitForLoadState('networkidle'),
            client.waitForLoadState('networkidle'),
          ]);
          mobileReviewApi.startFailureCollection();
          if (BREAK === 'mobile') {
            await stylist.route('**/api/v1/feature-flags', route =>
              route.fulfill({
                status: 429,
                json: { message: 'E2E_BREAK=mobile: forced rate limit' },
              })
            );
          }
          const issues: string[] = [];
          try {
            for (const [role, page, routes] of [
              [
                'stylist',
                stylist,
                [
                  '/app/home/',
                  '/app/gallery/',
                  '/app/clients/',
                  '/app/pairing/',
                  '/app/sessions/',
                  '/app/messages/',
                  '/app/notifications/',
                  '/app/profile/',
                  '/app/user/account/',
                  '/app/user/support/',
                ],
              ],
              [
                'client',
                client,
                [
                  '/app/home/',
                  '/app/stylists/',
                  '/app/favorites/',
                  '/app/sessions/',
                  '/app/messages/',
                  '/app/notifications/',
                  '/app/user/account/',
                  '/app/user/support/',
                ],
              ],
            ] as const) {
              for (const path of routes) {
                await mobileReviewApi.waitForHeadroom(page);
                const failuresBeforeNavigation =
                  mobileReviewApi.failures.length;
                await page.goto(path);
                await expect(page.locator('main')).toBeVisible();
                await expect(page.getByRole('heading').first()).toBeVisible();
                // A route heading is also present in several server-rendered skeletons. Wait for
                // both network settlement and the visible loading markers to disappear before the
                // screenshot, so the review cannot certify a shell as a rendered screen.
                await page.waitForLoadState('networkidle');
                await expect(
                  page.locator(
                    [
                      'main [class*="skeleton" i]:visible',
                      'main[aria-busy="true"]:visible',
                      'main [aria-busy="true"]:visible',
                    ].join(', ')
                  ),
                  `${role} ${path} still shows a loading state`
                ).toHaveCount(0);
                const bodyText = await page.locator('body').innerText();
                expect(
                  bodyText.match(POLISH_LOAD_ERROR)?.[0] ?? null,
                  `${role} ${path} displays a Polish data/loading error`
                ).toBeNull();
                expect(
                  mobileReviewApi.failuresSince(failuresBeforeNavigation),
                  `${role} ${path} made a local API request that failed`
                ).toEqual([]);
                const state = await page.evaluate(() => ({
                  path: location.pathname,
                  overflow:
                    document.documentElement.scrollWidth >
                    document.documentElement.clientWidth + 1,
                  text: document.body.innerText,
                }));
                if (
                  state.overflow ||
                  /Application error:|This page could not be found/.test(
                    state.text
                  )
                )
                  issues.push(`${role} ${path}: invalid render or overflow`);
                await shoot(page, `${role}-${path.replace(/\//g, '-')}`);
              }
            }
            expect(issues).toEqual([]);
            expect(
              mobileReviewApi.failures,
              'the mobile review observed failed local API requests'
            ).toEqual([]);
          } finally {
            await testInfo.attach('mobile-api-review.json', {
              body: JSON.stringify(
                {
                  cancellations: mobileReviewApi.cancellations,
                  failures: mobileReviewApi.failures,
                },
                null,
                2
              ),
              contentType: 'application/json',
            });
          }
        });
      }

      await test.step('no request left the machine except the replaced Cloudinary boundary', async () => {
        expect(
          fake.blocked,
          'unexpected third-party requests from the browser'
        ).toEqual([]);
      });
    } catch (error) {
      await shoot(stylist, 'failure-stylist').catch(() => undefined);
      await shoot(client, 'failure-client').catch(() => undefined);
      throw error;
    } finally {
      await stylistContext.close();
      await clientContext.close();
    }
  });
});
