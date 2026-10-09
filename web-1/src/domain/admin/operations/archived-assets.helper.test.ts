/**
 * Wyciąganie adresów plików z archiwum przed hard-purge (Art. 17).
 *
 * KLASA BŁĘDU, którą ta suita pinuje (znaleziona 2026-08-20): purge kasował
 * wiersz archiwum, nie tykając plików w chmurze, a razem z wierszem znikał
 * JEDYNY zapis tego, gdzie te pliki są. Plików nie dało się już odnaleźć
 * ani skasować.
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
    // Sedno wyboru rekursji zamiast listy ścieżek: archiwum ma własny kontrakt
    // „dopisz tu każdy nowy model kaskadowy", więc lista ścieżek rozjechałaby się
    // z nim po cichu — brak ścieżki nie wywala się, tylko zostawia plik w chmurze.
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
