import { describe, expect, it } from 'vitest';
import {
  publicProfilePhotoShareUrl,
  publicProfileShareUrl,
} from './_profile-share.helpers';

describe('publicProfileShareUrl', () => {
  it('keeps the origin and pathname and has no query to forward', () => {
    expect(
      publicProfileShareUrl({
        origin: 'https://nailfolio.app',
        pathname: '/stylist/anna/',
      })
    ).toBe('https://nailfolio.app/stylist/anna/');
  });
});

describe('publicProfilePhotoShareUrl', () => {
  it('links to the selected public photo without forwarding tracking or pair intent', () => {
    expect(
      publicProfilePhotoShareUrl(
        { origin: 'https://nailfolio.app', pathname: '/en/stylist/anna/' },
        'photo one'
      )
    ).toBe('https://nailfolio.app/en/stylist/anna/?photo=photo+one');
  });
});
