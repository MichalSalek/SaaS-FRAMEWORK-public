import { expect, test } from '@playwright/test';

for (const width of [1280, 1440]) {
  for (const locale of ['', '/en', '/de']) {
    test(`Nagłówek: odstępy i zawijanie ${locale || 'pl'} przy ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem(
          'dev-mode',
          JSON.stringify({ state: { isDevMode: true }, version: 0 })
        );
      });
      await page.goto(`${locale}/`, { waitUntil: 'domcontentloaded' });
      const header = page.getByRole('banner');
      const nav = header.locator('nav:visible');
      await expect(nav.locator('a')).toHaveCount(5);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await nav.evaluate(nav => {
        const logo = nav.previousElementSibling;
        const actions = nav.nextElementSibling;
        const control = actions?.firstElementChild;
        if (!logo || !actions || !control) {
          throw new Error('Brak elementów nagłówka');
        }
        const hints = Array.from(nav.querySelectorAll('a')).map(link => {
          const hint = link.lastElementChild;
          if (!hint) throw new Error('Brak podpowiedzi linku');
          const range = document.createRange();
          range.selectNodeContents(hint);
          return {
            width: hint.getBoundingClientRect().width,
            lines: range.getClientRects().length,
          };
        });
        return {
          logoGap:
            nav.getBoundingClientRect().left -
            logo.getBoundingClientRect().right,
          controlGap:
            control.getBoundingClientRect().left -
            nav.getBoundingClientRect().right,
          controlPadding: Number.parseFloat(
            getComputedStyle(actions).paddingInlineStart
          ),
          hints,
        };
      });
      expect(geometry.logoGap).toBeCloseTo(0);
      expect(geometry.controlGap).toBeCloseTo(12);
      expect(geometry.controlPadding).toBeGreaterThanOrEqual(12);
      for (const hint of geometry.hints)
        expect(hint.width).toBeLessThanOrEqual(120);
      expect(geometry.hints.at(-1)?.lines).toBe(2);
    });
  }
}
