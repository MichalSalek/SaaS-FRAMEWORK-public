// tests/prod/specs/prod-login.spec.ts
//
// Logowanie na PRODUKCJI w prawdziwej przeglądarce, bez żadnej furtki: test
// prosi o magic-link, odbiera go ze skrzynki po IMAP i wchodzi tym adresem,
// tak jak zrobiłby to użytkownik z telefonu.
//
// Pilnuje trzech rzeczy naraz, które w sierpniu 2026 potrafiły się rozjechać
// niezależnie: dostarczania maila, mostu tokenowego (adres z ?authCode musi
// wylądować na origin frontu) oraz tego, że zalogowany interfejs w ogóle się
// uwodnia na produkcyjnym CSP.

import { test, expect } from '@playwright/test';
import { CUSTOM_HEADERS } from '../../../.shared-kernel/domain/http/http.config';
import { PROD_CONFIG, hasMailboxCredentials } from '../prod-config';
import { loginViaMagicLink, signOut } from '../prod-auth';
import { purgeInbox, waitForMessage } from '../prod-inbox';

const MAGIC_LINK_RE =
  /https?:\/\/[^\s"'<>]+\/api\/auth\/magic-link\/verify\?[^\s"'<>]+/;

const SESSION_STORAGE_KEY: string = CUSTOM_HEADERS.authorization;

test.describe('produkcja: logowanie i zalogowany interfejs', () => {
  test.skip(
    !hasMailboxCredentials(),
    'Brak danych skrzynki testowej (E2E_MAILBOX_* w lokalnym pliku z sekretami).'
  );

  let token = '';

  test.afterAll(async () => {
    if (token) {
      await signOut(token);
    }
  });

  test('magic-link ze skrzynki wpuszcza do aplikacji', async ({ page }) => {
    const session = await loginViaMagicLink();
    token = session.token;

    // Most tokenowy ma przepisać adres na front — gdyby wypuścił na origin
    // backendu, użytkownik wylądowałby na stronie API zamiast w aplikacji.
    expect(new URL(session.landingUrl).origin).toBe(PROD_CONFIG.FRONTEND_URL);

    // Sesja żyje w localStorage pod tym samym kluczem, którego używa klient
    // aplikacji (transport Bearer, nie ciasteczka).
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key as string, value as string);
      },
      [SESSION_STORAGE_KEY, session.token]
    );

    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Zalogowany nie może zostać odesłany z powrotem na logowanie.
    expect(page.url()).not.toContain('/user/login');

    // Interfejs musi się uwodnić (regresja CSP/hydracji z czerwca 2026 objawiała
    // się pustą, martwą stroną mimo poprawnego HTML-a).
    const interactive = page.locator('a, button');
    await expect(interactive.first()).toBeVisible();
  });

  test('magic-link z /en/user/login ląduje na /en/app', async ({ page }) => {
    await purgeInbox();
    const since = new Date(Date.now() - 60_000);

    await page.goto('/en/user/login');
    await page.getByRole('button', { name: 'Necessary only' }).click();
    await page.getByRole('textbox').first().fill(PROD_CONFIG.MAILBOX_USER);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    const { matched } = await waitForMessage({ since, match: MAGIC_LINK_RE });
    await page.goto(matched);

    const pathname = new URL(page.url()).pathname;
    expect(pathname).toMatch(/^\/en\/app(\/|$)/);
    expect(page.url()).not.toContain('/user/login');

    const storedToken = await page.evaluate(
      key => window.localStorage.getItem(key),
      SESSION_STORAGE_KEY
    );
    if (storedToken) {
      await signOut(storedToken);
    } else {
      await page.evaluate(() => {
        window.localStorage.clear();
      });
    }
  });

  test('ekran logowania podaje obie drogi wejścia', async ({ page }) => {
    await page.goto('/user/login');
    await expect(page.getByRole('textbox').first()).toBeVisible();
    // Przycisk logowania Google renderuje się na produkcji (flaga OAuth on).
    await expect(page.getByText(/Google/i).first()).toBeVisible();
  });

  test('nieudane logowanie dostawcą tłumaczy się użytkownikowi', async ({
    page,
  }) => {
    // Dokładnie ten adres, na który backend odsyła po odrzuconym logowaniu
    // natywnym: musi pokazać powód i drogę powrotu do aplikacji, a nie pusty
    // formularz (incydent 2026-08-17).
    await page.goto('/user/login?nativeAuth=1&error=account_not_linked');
    // Next trzyma na stronie własny pusty element o roli „alert" (ogłaszanie
    // zmian trasy czytnikom ekranu), więc bierzemy ten z jakąkolwiek treścią.
    const banner = page.getByRole('alert').filter({ hasText: /\S/ }).first();
    await expect(banner).toBeVisible();
    await expect(page.locator('a[href^="nailfolio://"]').first()).toBeVisible();
  });
});
