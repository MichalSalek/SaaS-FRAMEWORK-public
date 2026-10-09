import { describe, it, expect } from 'vitest';
import {
  DEMO_PHOTOS_ANIA,
  type DemoPhoto,
} from './demo-content-seeding.photos';
import {
  DEMO_PHOTOS_OLA,
  DEMO_PHOTOS_NINA,
} from './demo-content-seeding.photos-guests';
import {
  DEMO_GALLERY,
  DEMO_KAROLINA_EXTRA_ANIA_LIKES,
  DEMO_KAROLINA_NINA_LIKES,
  DEMO_KAROLINA_OLA_LIKES,
  DEMO_PINNED_ANIA_EXTRA,
  DEMO_PINNED_NINA,
  DEMO_PINNED_OLA,
  DEMO_SESSION_CLOSED_EXTRA_PHOTO,
  DEMO_SESSION_DRAFT_PHOTOS,
  DEMO_SESSION_OLA_PHOTOS,
  DEMO_SESSION_SHARED_EXTRA_PHOTO,
  resolveDemoAssetUrl,
} from './demo-content-seeding.config';
import { DEMO_NEW_CLIENTS } from './demo-content-seeding.clients-data';
import { demoPhotoBaseName } from './demo-content-seeding.bank';
import { DEMO_REMOVED_PHOTO_NAMES } from './demo-content-seeding.cleanup';
import {
  DEMO_COMMUNITY_STYLISTS,
  DEMO_STAFF_PROFILES,
} from './demo-content-seeding.community-stylists-data';
import {
  DEMO_COMMUNITY_BROWSING,
  DEMO_COMMUNITY_PAIRS,
} from './demo-content-seeding.community-data';
import { DEMO_COMMUNITY_CONTENT_REPORTS } from './demo-content-seeding.community-extras-data';

/**
 * Dane wystawy demo: spójność referencji do zdjęć. Test istnieje, bo przy
 * wycofaniu 21 plików (2026-09-16) każda literówka albo osierocony URL byłyby
 * widoczne dopiero jako brakujące zdjęcie na ekranie.
 */

const BANKS: Record<string, readonly DemoPhoto[]> = {
  ania: DEMO_PHOTOS_ANIA,
  ola: DEMO_PHOTOS_OLA,
  nina: DEMO_PHOTOS_NINA,
};

const namesOf = (photos: readonly DemoPhoto[]): string[] =>
  photos.map(p => demoPhotoBaseName(p.asset_url) ?? '');

const galleryBySlug = new Map<string, string[]>([
  ...Object.entries(BANKS).map(
    ([slug, bank]) => [slug, namesOf(bank)] as [string, string[]]
  ),
  ...DEMO_COMMUNITY_STYLISTS.map(
    spec => [spec.slug, namesOf(spec.photos)] as [string, string[]]
  ),
]);

const ALL_URLS = [
  ...Object.values(BANKS).flatMap(bank =>
    bank.map(p => resolveDemoAssetUrl(p.asset_url))
  ),
  ...DEMO_GALLERY.map(e => e.asset_url),
  ...DEMO_PINNED_ANIA_EXTRA,
  ...DEMO_PINNED_OLA,
  ...DEMO_PINNED_NINA,
  ...DEMO_SESSION_DRAFT_PHOTOS.map(p => p.asset_url),
  ...DEMO_KAROLINA_EXTRA_ANIA_LIKES.map(p => p.asset_url),
  ...DEMO_SESSION_OLA_PHOTOS,
  ...DEMO_KAROLINA_OLA_LIKES,
  ...DEMO_KAROLINA_NINA_LIKES,
  DEMO_SESSION_SHARED_EXTRA_PHOTO,
  DEMO_SESSION_CLOSED_EXTRA_PHOTO,
  ...DEMO_NEW_CLIENTS.flatMap(c => [
    ...(c.sharedSession?.photoUrls ?? []),
    ...(c.likesOnAniaGallery ?? []),
  ]),
];

describe('dane wystawy demo', () => {
  it('zachowuje nazwy prac po odświeżeniu zdjęć i dla historycznych adresów', () => {
    expect(
      demoPhotoBaseName(
        'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791410000/demo-seed/nail-21-medium-red_review20261008.webp'
      )
    ).toBe('nail-21-medium-red');
    expect(
      demoPhotoBaseName(
        '/v1791334035/demo-seed/nail-21-medium-red_glamour20261007.webp'
      )
    ).toBe('nail-21-medium-red');
    expect(demoPhotoBaseName('/demo-seed/nail-21-medium-red_wpqm4q.webp')).toBe(
      'nail-21-medium-red'
    );
    expect(demoPhotoBaseName('/unrelated/nail-21-medium-red.webp')).toBeNull();
  });

  it('nigdzie nie odwołuje się do wycofanych plików', () => {
    const offenders = ALL_URLS.filter(url =>
      DEMO_REMOVED_PHOTO_NAMES.some(name => url.includes(`/demo-seed/${name}_`))
    );
    expect(offenders).toEqual([]);
  });

  it('każdy adres spoza banku byłby sierotą — wszystkie URL-e są z banków', () => {
    const bankUrls = new Set(
      Object.values(BANKS).flatMap(bank =>
        bank.map(p => resolveDemoAssetUrl(p.asset_url))
      )
    );
    expect(ALL_URLS.filter(url => !bankUrls.has(url))).toEqual([]);
  });

  it('żadna galeria nie ma duplikatu zdjęcia', () => {
    for (const [slug, names] of [
      ...galleryBySlug,
      ...DEMO_STAFF_PROFILES.map(
        s => [s.email, namesOf(s.photos)] as [string, string[]]
      ),
    ]) {
      expect(new Set(names).size, slug).toBe(names.length);
    }
  });

  it('każda stylistka ma co najmniej tyle prac, ile przypina', () => {
    for (const spec of [...DEMO_COMMUNITY_STYLISTS, ...DEMO_STAFF_PROFILES]) {
      expect(spec.photos.length).toBeGreaterThanOrEqual(spec.pinnedCount);
    }
  });

  it('lajki, sesje i zgłoszenia wskazują zdjęcia z galerii TEJ stylistki', () => {
    const check = (stylistSlug: string, photo: string, where: string) => {
      expect(galleryBySlug.get(stylistSlug) ?? [], where).toContain(photo);
    };
    for (const pair of DEMO_COMMUNITY_PAIRS) {
      for (const like of pair.likes ?? []) {
        check(pair.stylistSlug, like.photo, `lajk ${pair.clientSlug}`);
      }
      for (const photo of pair.session?.photos ?? []) {
        check(pair.stylistSlug, photo, `sesja ${pair.session?.name ?? ''}`);
      }
    }
    for (const entry of DEMO_COMMUNITY_BROWSING) {
      for (const like of entry.likes) {
        check(entry.stylistSlug, like.photo, `lajk ${entry.clientSlug}`);
      }
    }
    for (const report of DEMO_COMMUNITY_CONTENT_REPORTS) {
      check(report.stylistSlug, report.photo, `zgłoszenie ${report.reason}`);
    }
  });
});
