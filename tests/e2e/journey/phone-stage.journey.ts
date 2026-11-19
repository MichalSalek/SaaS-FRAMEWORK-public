import { expect, test } from '@playwright/test';

test('the active phone grows and the previous one shrinks on desktop and mobile', async ({
  page,
}) => {
  for (const { width, property } of [
    { width: 1440, property: 'width' },
    { width: 390, property: 'transform' },
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const stage = page.getByRole('region', {
      name: 'Podgląd ekranów aplikacji',
    });
    await expect(stage.getByRole('button')).toHaveCount(3);
    await stage.scrollIntoViewIfNeeded();
    const measured = await stage.evaluate(async (element, property) => {
      const phones = [
        ...element.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
      ];
      const [next, previous] = phones;
      if (!next || !previous) {
        throw new Error('Missing phone controls');
      }
      const widths = () =>
        phones.map(phone => phone.getBoundingClientRect().width);
      const before = widths();
      next.focus();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const transitions = [next, previous].flatMap(phone =>
        phone
          .getAnimations()
          .filter(
            animation =>
              animation instanceof CSSTransition &&
              animation.transitionProperty === property
          )
      );
      // Sample the browser's actual interpolation at a stable point.
      for (const transition of transitions) {
        transition.pause();
        transition.currentTime =
          Number(transition.effect?.getTiming().duration) / 2;
      }
      const middle = widths();
      for (const transition of transitions) {
        transition.finish();
      }
      return { before, middle, after: widths(), count: transitions.length };
    }, property);
    expect(measured.count).toBe(2);
    const [beforeNext = 0, beforePrevious = 0] = measured.before;
    const [middleNext = 0, middlePrevious = 0] = measured.middle;
    const [afterNext = 0, afterPrevious = 0] = measured.after;
    expect(middleNext).toBeGreaterThan(beforeNext);
    expect(middleNext).toBeLessThan(afterNext);
    expect(middlePrevious).toBeLessThan(beforePrevious);
    expect(middlePrevious).toBeGreaterThan(afterPrevious);
    await expect(stage.getByRole('button').first()).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  }
});
