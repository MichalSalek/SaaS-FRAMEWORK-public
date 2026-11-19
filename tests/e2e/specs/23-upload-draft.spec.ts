import { expect, test, type BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';
import { CUSTOM_HEADERS } from '../../../.shared-kernel/domain/http/http.config';
import { APP_EVENTS } from '../../../.shared-kernel/domain/events/app-events.const';
import {
  ROUTES_API,
  ROUTES_FRONT,
} from '../../../.shared-kernel/domain/routing/routing.config';
import { PricingPlanValue } from '../../../.shared-kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  AccountTypeValue,
  PaymentStatusValue,
} from '../../../.shared-kernel/models/db_models.generated.dto';
import { SystemRoleId } from '../../../.shared-kernel/models/db_models.manual.dto';
import { FakeCloudinary } from '../journey/boundaries';
import { E2E_ENV } from '../helpers/env';
import { dismissCookieBanner } from '../helpers/ui';
import type { PersistedUploadDraft } from '../../../main/src/UI/features/gallery/hooks/uploadDraftPersistence';

type GalleryCreatePayload = {
  asset_url: string;
  color_ids: string[];
  trait_ids: string[];
  nail_length: string;
};

async function installBoundaries(
  context: BrowserContext,
  fake: FakeCloudinary,
  writes: { gallery: GalleryCreatePayload[]; blocked: string[] }
) {
  const backendOrigin = new URL(E2E_ENV.BACKEND_URL).origin;
  const localHosts = new Set(['localhost', '127.0.0.1']);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const userId = 'e2e-upload-draft-user';
  const user = {
    id: userId,
    email: 'upload-draft@example.test',
    emailVerified: true,
    image: null,
    name: 'E2E Stylist',
    role_id: SystemRoleId.STYLIST_ROLE,
    createdAt: now,
    updatedAt: now,
    is_active: true,
    disabled_at: null,
    deleted_at: null,
    recovery_available: false,
    account_type: AccountTypeValue.STYLIST,
    notifications_enabled: true,
    terms_accepted_at: now,
    last_login_at: now,
    moderation_strikes: 0,
    delete_confirm_version: 1,
    session: {
      id: 'e2e-upload-draft-session',
      expires,
      ip_address: null,
      user_agent: 'Playwright',
      device_type: 'WEB',
      createdAt: now,
      updatedAt: now,
    },
    stylist_account: {
      account_id: 'e2e-upload-draft-account',
      display_name: 'E2E Stylist',
      business_name: null,
      address_street: null,
      address_city: 'Warszawa',
      address_postal_code: null,
      address_country: 'PL',
      phone: null,
      website: null,
      description: null,
      vanity_url: null,
      instagram_handle: null,
      avatar_url: null,
      brand_accent_color: null,
      view_count: 0,
      pricing_plan: PricingPlanValue.FREE,
      payment_status: PaymentStatusValue.PAID,
      account_status: AccountStatusValue.ACTIVE,
      plan_selected_at: now,
      subscription_status: null,
      cancel_at_period_end: false,
      cancel_at: null,
      current_period_end: null,
      trial_started_at: null,
      trial_ends_at: null,
      admin_plan_override: false,
      email_preferences: { trial_sequence: true, marketing: true },
      effective_pricing_plan: PricingPlanValue.FREE,
      has_salon_profile: false,
    },
    client_account: null,
  };
  const success = (data: unknown) => ({ event: 'APPLICATION_SUCCESS', data });

  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === backendOrigin && url.pathname.startsWith('/api/')) {
      const method = route.request().method();
      if (method === 'OPTIONS') {
        const requestHeaders =
          route.request().headers()['access-control-request-headers'] ??
          'authorization,content-type';
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin':
              route.request().headers().origin ?? 'http://localhost:3000',
            'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET,POST,OPTIONS,PUT,PATCH,DELETE',
            'access-control-allow-headers': requestHeaders,
          },
        });
        return;
      }

      const corsHeaders = {
        'access-control-allow-origin':
          route.request().headers().origin ?? 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
      };
      const respond = async (status: number, data: unknown) =>
        route.fulfill({
          status,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify(data),
        });
      const pathname = url.pathname;

      if (method === 'GET' && pathname.endsWith('/api/auth/get-session')) {
        await respond(200, {
          session: {
            id: 'e2e-upload-draft-session',
            token: 'e2e-upload-draft-session-token',
            userId,
            expiresAt: expires,
            createdAt: now,
            updatedAt: now,
            ipAddress: null,
            userAgent: 'Playwright',
          },
          user: {
            id: userId,
            name: 'E2E Stylist',
            email: 'upload-draft@example.test',
            emailVerified: true,
            image: null,
            createdAt: now,
            updatedAt: now,
            role_id: SystemRoleId.STYLIST_ROLE,
            account_type: AccountTypeValue.STYLIST,
          },
        });
        return;
      }

      if (method === 'GET') {
        if (pathname === ROUTES_API.SESSION_GET_CURRENT) {
          await respond(200, success(user));
          return;
        }
        if (pathname === ROUTES_API.USER_GET_USAGE_STATS) {
          await respond(
            200,
            success({
              gallery_records: 0,
              limits: { max_gallery_records: 5 },
            })
          );
          return;
        }
        if (pathname === ROUTES_API.GET_COLORS) {
          await respond(
            200,
            success([
              { id: 'e2e-color-pink', name: 'Różowe', hex_code: '#D3266F' },
            ])
          );
          return;
        }
        if (pathname === ROUTES_API.GET_TRAITS) {
          await respond(
            200,
            success([
              {
                id: 'e2e-trait-french',
                name: 'French',
                category: 'technique',
                icon_url: null,
                is_featured: false,
              },
            ])
          );
          return;
        }
        if (pathname.endsWith('/messaging/conversations')) {
          await respond(200, success({ conversations: [], next_cursor: null }));
          return;
        }
        if (pathname.endsWith('/salon/invitations')) {
          await respond(200, success({ invitations: [] }));
          return;
        }
        if (pathname.endsWith('/notifications/unread-count')) {
          await respond(200, success({ unread_count: 0 }));
          return;
        }
        if (pathname.endsWith('/runtime-config')) {
          await respond(
            200,
            success({
              maintenanceMessage: '',
              maintenanceMode: false,
              verboseLogMode: false,
            })
          );
          return;
        }
        if (pathname.endsWith('/feature-flags')) {
          await respond(200, success({}));
          return;
        }
        if (pathname.endsWith('/announcements/active')) {
          await respond(200, success([]));
          return;
        }
        await respond(200, success({}));
        return;
      }

      if (method === 'POST' && pathname === ROUTES_API.CREATE_GALLERY_RECORD) {
        writes.gallery.push(
          route.request().postDataJSON() as GalleryCreatePayload
        );
        await respond(403, {
          event: APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
          data: {
            currentCount: 5,
            limit: 5,
            planType: PricingPlanValue.FREE,
          },
        });
        return;
      }

      if (method === 'POST' && pathname === ROUTES_API.SEND_LOG) {
        // Diagnostic writes are sunk locally so the test never creates log rows.
        await respond(200, success({}));
        return;
      }

      if (method !== 'GET') {
        writes.blocked.push(`${method} ${pathname}`);
        await route.abort('blockedbyclient');
        return;
      }
    }
    if (localHosts.has(url.hostname)) {
      await route.continue();
      return;
    }
    if (url.hostname === 'api.cloudinary.com') {
      await fake.handleUpload(route);
      return;
    }
    if (url.hostname === 'res.cloudinary.com') {
      await fake.handleCdn(route);
      return;
    }
    fake.blocked.push(
      `${route.request().method()} ${url.origin}${url.pathname}`
    );
    await route.abort('blockedbyclient');
  });
}

test('limit response keeps the cropped draft after dismissing the upgrade and reloading', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'nf_internal', value: '1', domain: 'localhost', path: '/' },
  ]);
  await context.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: CUSTOM_HEADERS.authorization, value: 'e2e-upload-draft-token' }
  );

  const cloudinary = new FakeCloudinary('');
  const writes = {
    gallery: [] as GalleryCreatePayload[],
    blocked: [] as string[],
  };
  await installBoundaries(context, cloudinary, writes);

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
    page.getByRole('heading', { name: 'Sprawdź szczegóły', exact: true })
  ).toBeVisible();
  const previewButton = page.locator('button[aria-haspopup="dialog"]');
  const draftPreviewSrc = await previewButton
    .locator('img')
    .getAttribute('src');
  expect(draftPreviewSrc).toMatch(/^blob:/);
  await expect(page.getByText('Różowe', { exact: true })).toBeVisible();
  await expect(page.getByText('French', { exact: true })).toBeVisible();
  await expect(page.getByText('Krótkie', { exact: true })).toBeVisible();

  await page
    .getByRole('button', { name: 'Opublikuj zdjęcie', exact: true })
    .click();
  const upgradeDialog = page.getByRole('dialog', {
    name: 'Zmień plan',
    exact: true,
  });
  await expect(upgradeDialog).toBeVisible();
  expect(cloudinary.uploads).toHaveLength(1);
  await expect(
    upgradeDialog.getByRole('link', { name: 'Zobacz plan Pro' })
  ).toBeVisible();

  await upgradeDialog
    .getByRole('button', { name: 'Wróć', exact: true })
    .click();
  await expect(upgradeDialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Coś poszło nie tak' })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Wróć do podsumowania', exact: true })
    .click();

  await expect(
    page.getByRole('heading', { name: 'Sprawdź szczegóły', exact: true })
  ).toBeVisible();
  await expect(
    page.locator('button[aria-haspopup="dialog"] img')
  ).toHaveAttribute('src', draftPreviewSrc ?? '');
  await expect(page.getByText('Różowe', { exact: true })).toBeVisible();
  await expect(page.getByText('French', { exact: true })).toBeVisible();
  await expect(page.getByText('Krótkie', { exact: true })).toBeVisible();

  const previewHash = () =>
    page.locator('button[aria-haspopup="dialog"] img').evaluate(async image => {
      if (!(image instanceof HTMLImageElement)) {
        throw new Error('Brak podglądu zdjęcia');
      }
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const drawing = canvas.getContext('2d');
      if (!drawing) throw new Error('Brak kontekstu obrazu');
      drawing.drawImage(image, 0, 0);
      const pixels = drawing.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      ).data;
      const hash = await crypto.subtle.digest('SHA-256', pixels);
      return [...new Uint8Array(hash)]
        .map(value => value.toString(16).padStart(2, '0'))
        .join('');
    });
  const beforeReloadHash = await previewHash();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (
          !(await indexedDB.databases()).some(
            database => database.name === 'nailfolio-upload-drafts'
          )
        ) {
          return null;
        }
        return new Promise(resolveDraft => {
          const opening = indexedDB.open('nailfolio-upload-drafts');
          opening.onerror = () => resolveDraft(null);
          opening.onsuccess = () => {
            const database = opening.result;
            if (!database.objectStoreNames.contains('drafts')) {
              database.close();
              resolveDraft(null);
              return;
            }
            const request = database
              .transaction('drafts', 'readonly')
              .objectStore('drafts')
              .get('e2e-upload-draft-user');
            request.onerror = () => resolveDraft(null);
            request.onsuccess = () => {
              const draft = request.result as PersistedUploadDraft | undefined;
              database.close();
              resolveDraft(
                draft
                  ? {
                      step: draft.step,
                      colors: draft.selectedColorIds,
                      traits: draft.selectedTraitIds,
                      length: draft.selectedLength,
                      cropped: (draft.croppedFile?.blob.size ?? 0) > 0,
                    }
                  : null
              );
            };
          };
        });
      })
    )
    .toEqual({
      step: 3,
      colors: ['e2e-color-pink'],
      traits: ['e2e-trait-french'],
      length: 'SHORT',
      cropped: true,
    });

  // A new document discards module memory and Blob URLs, just like a return
  // from a payment provider. The actual IndexedDB copy must restore the pixels.
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-upload-reload-proof', 'before');
  });
  const reloaded = await page.reload();
  expect(reloaded?.status()).toBe(200);
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-upload-reload-proof',
    'before'
  );
  await expect(
    page.getByRole('heading', { name: 'Sprawdź szczegóły', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Różowe', { exact: true })).toBeVisible();
  await expect(page.getByText('French', { exact: true })).toBeVisible();
  await expect(page.getByText('Krótkie', { exact: true })).toBeVisible();
  expect(await previewHash()).toBe(beforeReloadHash);

  expect(cloudinary.attempts).toEqual([{ accepted: true }]);
  expect(cloudinary.uploads[0]?.bytes).toBeGreaterThan(0);
  expect(writes.gallery).toHaveLength(1);
  expect(writes.gallery[0]).toMatchObject({
    asset_url: cloudinary.uploads[0]?.secureUrl,
    color_ids: [expect.any(String)],
    trait_ids: [expect.any(String)],
    nail_length: 'SHORT',
  });
  expect(writes.blocked).toEqual([]);
  expect(cloudinary.blocked.some(host => /stripe|checkout/i.test(host))).toBe(
    false
  );
});
