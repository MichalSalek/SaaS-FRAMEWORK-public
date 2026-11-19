/**
 * Collecting file URLs from the archive before a hard purge (Art. 17).
 *
 * The class this suite pins (found 2026-08-20): the only path that actually
 * deleted data removed the archive row and left the files in the cloud. The
 * row was the only record of where those files are. The photos stayed publicly
 * downloadable at the processor, with no trail left.
 */

import { describe, it, expect } from 'vitest';
import { collectArchivedAssetUrls } from './archived-assets.helper';

describe('collectArchivedAssetUrls', () => {
  it('zbiera adresy ze WSZYSTKICH gałęzi archiwum, nie tylko z galerii', () => {
    const body = {
      stylist_account: {
        gallery_record: [
          { asset_url: 'https://res.cloudinary.com/x/galeria-1.jpg' },
          { asset_url: 'https://res.cloudinary.com/x/galeria-2.jpg' },
        ],
        stylist_visits: [
          {
            result_photos: [
              {
                asset_url: 'https://res.cloudinary.com/x/wizyta-stylistki.jpg',
              },
            ],
          },
        ],
      },
      client_visits: [
        {
          result_photos: [
            { asset_url: 'https://res.cloudinary.com/x/wizyta-klientki.jpg' },
          ],
        },
      ],
    };

    expect(collectArchivedAssetUrls(body).sort()).toEqual([
      'https://res.cloudinary.com/x/galeria-1.jpg',
      'https://res.cloudinary.com/x/galeria-2.jpg',
      'https://res.cloudinary.com/x/wizyta-klientki.jpg',
      'https://res.cloudinary.com/x/wizyta-stylistki.jpg',
    ]);
  });

  it('nadąża za archiwum, które urośnie o nowy model ze zdjęciami', () => {
    // Why a walk, not a path list: the archive contract says „dopisz tu każdy nowy model kaskadowy",
    // so a path list would drift from it quietly. A missing path does not throw. It leaves the file in the cloud.
    const body = {
      jakis_przyszly_model: [
        {
          nested: {
            deeper: [{ asset_url: 'https://res.cloudinary.com/x/nowe.jpg' }],
          },
        },
      ],
    };

    expect(collectArchivedAssetUrls(body)).toEqual([
      'https://res.cloudinary.com/x/nowe.jpg',
    ]);
  });

  it('deduplikuje ten sam adres użyty w kilku miejscach', () => {
    const body = {
      a: [{ asset_url: 'https://res.cloudinary.com/x/ten-sam.jpg' }],
      b: [{ asset_url: 'https://res.cloudinary.com/x/ten-sam.jpg' }],
    };

    expect(collectArchivedAssetUrls(body)).toHaveLength(1);
  });

  it('nie wywraca się na archiwum pustym, nietypowym albo z podmienionymi typami', () => {
    expect(collectArchivedAssetUrls(null)).toEqual([]);
    expect(collectArchivedAssetUrls(undefined)).toEqual([]);
    expect(collectArchivedAssetUrls('nie-obiekt')).toEqual([]);
    expect(collectArchivedAssetUrls({})).toEqual([]);
    // asset_url innego typu niż string ignorujemy, zamiast wpychać śmieć do kasowania.
    expect(collectArchivedAssetUrls({ asset_url: 42 })).toEqual([]);
    expect(collectArchivedAssetUrls({ asset_url: '' })).toEqual([]);
  });

  it('przeżywa cykl w danych bez zapętlenia', () => {
    const node: Record<string, unknown> = {
      asset_url: 'https://res.cloudinary.com/x/cykl.jpg',
    };
    node.self = node;

    expect(collectArchivedAssetUrls(node)).toEqual([
      'https://res.cloudinary.com/x/cykl.jpg',
    ]);
  });
});

it('collects salon logos and excludes OAuth image variants from terminal cleanup', () => {
  const image =
    'https://res.cloudinary.com/demo/image/upload/v123/nailfolio/photo.jpg';
  const variant =
    'https://res.cloudinary.com/demo/image/upload/w_100/v123/nailfolio/photo.png';
  expect(
    collectArchivedAssetUrls({
      image,
      avatar_url: variant,
      stylist_account: { salon_logo_url: 'logo' },
    })
  ).toEqual(['logo']);
});
