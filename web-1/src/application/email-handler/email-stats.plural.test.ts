import { describe, it, expect } from 'vitest';
import { expandPluralPlaceholders } from './email-stats';

describe('expandPluralPlaceholders', () => {
  const pl = (n: number) =>
    expandPluralPlaceholders(
      'masz {{n#pracę|prace|prac}}',
      { n: String(n) },
      'pl'
    );

  it.each([
    [1, 'masz 1 pracę'],
    [2, 'masz 2 prace'],
    [4, 'masz 4 prace'],
    [5, 'masz 5 prac'],
    [12, 'masz 12 prac'],
    [14, 'masz 14 prac'],
    [22, 'masz 22 prace'],
    [25, 'masz 25 prac'],
  ])('Polish forms: %i', (n, expected) => {
    expect(pl(n)).toBe(expected);
  });

  it('EN/DE use one|other', () => {
    const tpl = '{{d#day|days}} left';
    expect(expandPluralPlaceholders(tpl, { d: '1' }, 'en')).toBe('1 day left');
    expect(expandPluralPlaceholders(tpl, { d: '3' }, 'en')).toBe('3 days left');
    expect(expandPluralPlaceholders('{{d#Tag|Tage}}', { d: '21' }, 'de')).toBe(
      '21 Tage'
    );
  });

  it('drops the placeholder when the value is not a number', () => {
    expect(expandPluralPlaceholders('{{n#a|b|c}}', {}, 'pl')).toBe('');
  });

  it('leaves plain placeholders for the regular interpolation', () => {
    expect(
      expandPluralPlaceholders('{{name}}: {{n#a|b|c}}', { n: '1' }, 'pl')
    ).toBe('{{name}}: 1 a');
  });
});
