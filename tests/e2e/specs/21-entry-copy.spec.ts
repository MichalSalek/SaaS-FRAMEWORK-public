import { expect, test } from '@playwright/test';
import { dismissCookieBanner } from '../helpers/ui';
import { STORAGE_KEYS } from '../../../main/src/application/client-device-storage/storage-keys.config';

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: 'nf_internal', value: '1', domain: 'localhost', path: '/' },
  ]);
});

test('Start zachowuje malinową górę i odwraca tylko dół w ciemnym motywie', async ({
  page,
}) => {
  await page.goto('/welcome/');
  await dismissCookieBanner(page);
  const samples = [];
  for (const mode of ['light', 'dark']) {
    await page.locator('html').evaluate((element, value) => {
      element.setAttribute('data-mode', value);
    }, mode);
    samples.push(
      await page.getByRole('main').evaluate(element => {
        const lower = element.lastElementChild;
        const heading = element.querySelector('h1');
        if (!lower || !heading) throw new Error('Brak sekcji startu');
        const rgb = (color: string) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Brak kontekstu koloru');
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        return {
          top: rgb(getComputedStyle(element).backgroundColor),
          topText: rgb(getComputedStyle(heading).color),
          lower: rgb(getComputedStyle(lower).backgroundColor),
          lowerText: rgb(getComputedStyle(lower).color),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      })
    );
  }
  const [light, dark] = samples;
  if (!light || !dark) throw new Error('Brak pomiaru motywów');
  expect(dark.top).toEqual(light.top);
  expect(dark.topText).toEqual(light.topText);
  expect(Math.max(...dark.lower)).toBeLessThan(60);
  expect(Math.min(...light.lower)).toBeGreaterThan(240);
  expect(Math.min(...dark.lowerText)).toBeGreaterThan(240);
  expect(Math.max(...light.lowerText)).toBeLessThan(60);
  expect(samples.every(sample => !sample.overflow)).toBe(true);
});

test('Wspólny start nie narzuca roli przy rejestracji', async ({ page }) => {
  await page.goto('/welcome/');
  await dismissCookieBanner(page);
  const start = page.getByRole('link', { name: 'Załóż konto', exact: true });
  const href = await start.getAttribute('href');
  if (!href) throw new Error('Brak adresu rejestracji');
  const target = new URL(href, page.url());
  expect(target.searchParams.get('intent')).toBe('register');
  expect(target.searchParams.has('role')).toBe(false);
  await expect(
    page.getByRole('main').getByText('Free Demo', { exact: true })
  ).toHaveCount(0);
  await start.click();
  await expect(page).toHaveURL(/intent=register/);
  expect(new URL(page.url()).searchParams.has('role')).toBe(false);
});

test('Mobilny nagłówek nie dziedziczy desktopowego podkreślenia', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const header = page.getByRole('banner');
  await expect(header).toBeVisible();
  const geometry = await header.evaluate(element => {
    const logo = element.querySelector('a');
    return {
      height: element.getBoundingClientRect().height,
      border: logo ? getComputedStyle(logo).borderBottomWidth : null,
    };
  });
  expect(geometry.height).toBe(59);
  expect(geometry.border).toBe('2px');
  const color = await header
    .locator('a')
    .first()
    .evaluate(element => getComputedStyle(element).borderBottomColor);
  expect(color).toBe('rgba(0, 0, 0, 0)');
});

test('Rejestracja pokazuje pole i czynność, a pomoc pozostaje dostępna', async ({
  page,
}) => {
  await page.goto('/user/login/?intent=register&role=stylist');
  await dismissCookieBanner(page);
  await expect(
    page.getByRole('heading', { name: 'Załóż konto', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'E-mail', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Kontynuuj', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/Konto klientki jest bezpłatne|konto powstaje po|do 5 zdjęć/)
  ).toHaveCount(0);
  const help = page.getByRole('button', { name: 'Pomoc', exact: true });
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await help.scrollIntoViewIfNeeded();
  const before = await help.boundingBox();
  if (!before) throw new Error('Brak geometrii przycisku Pomoc');
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2
  );
  await page.mouse.down();
  const held = await help.boundingBox();
  await page.mouse.up();
  expect(held?.x).toBeCloseTo(before.x);
  expect(held?.width).toBeCloseTo(before.width);
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await help.click();
  await help.click();
  await expect(
    page.getByRole('link', { name: 'Przywróć zamknięte konto' })
  ).toBeVisible();
});

test('Start rejestracji usuwa poprzedni wybór płatnego planu', async ({
  page,
}) => {
  await page.goto('/pricing/');
  await dismissCookieBanner(page);
  await page.getByRole('link', { name: 'Wybierz Pro', exact: true }).click();
  await expect(page).toHaveURL(/\/user\/login/);
  await expect
    .poll(() =>
      page.evaluate(
        key => sessionStorage.getItem(key),
        STORAGE_KEYS.PRICING_FUNNEL
      )
    )
    .not.toBeNull();
  await page.goto('/welcome/');
  await page.getByRole('link', { name: 'Załóż konto', exact: true }).click();
  await expect(page).toHaveURL(/\/user\/login/);
  await expect
    .poll(() =>
      page.evaluate(
        key => sessionStorage.getItem(key),
        STORAGE_KEYS.PRICING_FUNNEL
      )
    )
    .toBeNull();
});

test('Wejście APK bez sesji przechodzi do welcome i pozwala wrócić na stronę główną', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('authorization');
    sessionStorage.clear();
    window.addEventListener(
      'nf:native-startup-ready',
      () => (document.documentElement.dataset['startupProbeReady'] = '1')
    );
  });
  await page.goto('/?platform=android');
  await expect(page).toHaveURL(/\/welcome\/?$/);
  await expect(page.locator('html')).toHaveAttribute(
    'data-startup-probe-ready',
    '1'
  );
  await expect(
    page.getByText('Najpierw się zaloguj', { exact: true })
  ).toHaveCount(0);
  await dismissCookieBanner(page);
  await page.getByRole('link', { name: 'Strona główna', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('banner')).toBeVisible();
});
