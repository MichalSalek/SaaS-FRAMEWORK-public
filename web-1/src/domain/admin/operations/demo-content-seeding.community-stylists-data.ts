import {
  PaymentStatusValue,
  type PaymentStatus,
} from '@kernel/models/db_models.generated.dto';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { DemoPhoto } from './demo-content-seeding.photos';
import { brandHex } from './demo-content-seeding.config';
import { demoPhotosByName as pick } from './demo-content-seeding.bank';

/**
 * Warstwa „społeczności" wystawy demo (2026-09-15): pięć kolejnych stylistek
 * na różnych planach i w różnych miastach, profile personelu salonu Ani oraz
 * dwie nowe klientki. Razem z S111 daje 10 kont stylistek i 10 klientek.
 *
 * Zdjęcia: WYŁĄCZNIE pliki już wgrane do folderu demo-seed (banki
 * DEMO_PHOTOS_*). Nowych plików nie ma skąd wziąć bez uploadu, więc prace nowych
 * stylistek to podzbiory banków Ani, Oli i Niny (wybierane PO NAZWIE pliku,
 * demo-content-seeding.bank.ts), a galeria nowych stylistek jest postarzona (galleryAgeOffsetDays),
 * żeby nie wypychała wystawy S111 z góry feedu „Odkrywaj". Współdzielony plik
 * jest bezpieczny przy kasowaniu: sink Cloudinary sprawdza, czy ktoś jeszcze
 * go używa (gallery-cloudinary-cleanup.ts).
 */

// type (nie interface): alias dostaje zgodność z Record<string, …>, której
// oczekuje ensureGuestStylist_IO.
export type DemoStylistProfile = {
  business_name?: string;
  address_city: string;
  instagram_handle?: string;
  vanity_url: string;
  phone?: string;
  website?: string;
  brand_accent_color?: string;
  description: string;
};

export interface DemoCommunityStylistSpec {
  slug: string;
  email: string;
  displayName: string;
  plan: PricingPlan;
  paymentStatus: PaymentStatus;
  /** true = trwający okres próbny Pro, kończy się za kilka dni (baner odliczania). */
  trial: boolean;
  profile: DemoStylistProfile;
  photos: readonly DemoPhoto[];
  pinnedCount: number;
  galleryAgeOffsetDays: number;
}

export const DEMO_COMMUNITY_STYLISTS: readonly DemoCommunityStylistSpec[] = [
  {
    slug: 'ewelina',
    email: 'demo-stylist-ewelina@example.com',
    displayName: 'Ewelina Dąbrowska',
    plan: PricingPlanValue.FREE,
    paymentStatus: PaymentStatusValue.UNPAID,
    trial: false,
    profile: {
      address_city: 'Poznań',
      instagram_handle: 'demo.ewelina.nails',
      vanity_url: 'ewelina-nails-poznan',
      description:
        'Manicure hybrydowy w domowym gabinecie na Jeżycach. Stawiam na krótkie, ' +
        'zadbane paznokcie i spokojne kolory. Portfolio dopiero rośnie, więc zaglądaj częściej.',
    },
    // FREE: limit 5 zdjęć i 3 pinów, wystawa pokazuje konto na samym suficie.
    photos: pick([
      'hero-nail-01-nude',
      'hero-nail-03-geometric',
      'hero-nail-05-floral',
      'hero-nail-09-dark-editorial',
      'nail-53-jelly-oil-droplet',
    ]),
    pinnedCount: 3,
    galleryAgeOffsetDays: 45,
  },
  {
    slug: 'joanna',
    email: 'demo-stylist-joanna@example.com',
    displayName: 'Joanna Pawlak',
    plan: PricingPlanValue.PRO,
    paymentStatus: PaymentStatusValue.PAID,
    trial: true,
    profile: {
      business_name: 'Studio Pazur',
      address_city: 'Wrocław',
      instagram_handle: 'demo.studio.pazur',
      vanity_url: 'studio-pazur',
      phone: '+48 500 100 103',
      description:
        'Studio na Nadodrzu, dwa stanowiska i dużo dziennego światła. Robię ' +
        'hybrydę, żel i rekonstrukcje. Na pierwszą wizytę zapraszam z inspiracjami, ' +
        'razem dobierzemy długość i kształt.',
    },
    photos: pick([
      'nail-01',
      'nail-05',
      'nail-07',
      'nail-13-short-pastel',
      'nail-24-medium-floral',
      'nail-32-long-minimal-line',
      'nail-41-medium-baby-boomer',
      'nail-51-medium-3d-gel-droplets',
    ]),
    pinnedCount: 4,
    galleryAgeOffsetDays: 30,
  },
  {
    slug: 'monika',
    email: 'demo-stylist-monika@example.com',
    displayName: 'Monika Grabowska',
    plan: PricingPlanValue.SCALE,
    paymentStatus: PaymentStatusValue.PAID,
    trial: false,
    profile: {
      business_name: 'Pracownia Monika G.',
      address_city: 'Łódź',
      instagram_handle: 'demo.pracownia.monika',
      vanity_url: 'pracownia-monika',
      phone: '+48 500 100 104',
      website: 'pracownia-monika.example.com',
      brand_accent_color: brandHex('teal'),
      description:
        'Pracownia w kamienicy przy Piotrkowskiej. Specjalizuję się w ombre, ' +
        'geometrii i mocnych kolorach na długich paznokciach. Terminy układam ' +
        'z dwutygodniowym wyprzedzeniem.',
    },
    photos: pick([
      'nail-08',
      'hero-nail-04-ombre',
      'nail-03',
      'nail-14-short-glitter',
      'nail-20-medium-geometric',
      'nail-26-long-ombre',
      'nail-40-xl-pastel',
    ]),
    pinnedCount: 4,
    galleryAgeOffsetDays: 20,
  },
  {
    slug: 'agnieszka',
    email: 'demo-stylist-agnieszka@example.com',
    displayName: 'Agnieszka Zielińska',
    plan: PricingPlanValue.PRO_PLUS,
    paymentStatus: PaymentStatusValue.PAID,
    trial: false,
    profile: {
      business_name: 'Nail Room Katowice',
      address_city: 'Katowice',
      instagram_handle: 'demo.nailroom',
      vanity_url: 'nail-room-katowice',
      brand_accent_color: brandHex('plum'),
      description:
        'Kameralny gabinet blisko rynku. Lubię zdobienia w stylu edytorialnym, ' +
        'ciemne lakiery i efekt kociego oka. Każdą klientkę pytam o pielęgnację ' +
        'między wizytami.',
    },
    photos: pick([
      'hero-nail-06-ink-violet',
      'nail-06',
      'nail-discover-02',
      'nail-43-medium-cat-eye-rose-gold',
      'nail-50-long-black-cherry',
      'nail-47-medium-aura-blush',
    ]),
    pinnedCount: 3,
    galleryAgeOffsetDays: 25,
  },
  {
    slug: 'sylwia',
    email: 'demo-stylist-sylwia@example.com',
    displayName: 'Sylwia Majewska',
    plan: PricingPlanValue.FREE,
    paymentStatus: PaymentStatusValue.UNPAID,
    trial: false,
    profile: {
      address_city: 'Lublin',
      vanity_url: 'sylwia-manicure-lublin',
      description:
        'Zaczynałam od paznokci koleżanek, dziś przyjmuję w małym gabinecie na ' +
        'Czubach. Najczęściej robię french i delikatne kwiatowe wzorki.',
    },
    photos: pick([
      'nail-discover-01',
      'nail-discover-03',
      'nail-42-medium-sage-micro-french',
      'hero-nail-14-bridal-milky-white',
      'nail-09-short-nude',
    ]),
    pinnedCount: 2,
    galleryAgeOffsetDays: 60,
  },
];

/**
 * Personel salonu Ani (Marta, Kasia) dostaje wizytówkę i kilka prac. Konta
 * powstają w ensureSalonStaff_IO (S111); tu tylko dane profilu, uzupełniane
 * wyłącznie w pustych polach.
 */
export const DEMO_STAFF_PROFILES: readonly {
  email: string;
  profile: DemoStylistProfile;
  photos: readonly DemoPhoto[];
  pinnedCount: number;
  galleryAgeOffsetDays: number;
}[] = [
  {
    email: 'demo-staff-marta@example.com',
    profile: {
      business_name: 'Studio Velvet Nails',
      address_city: 'Warszawa',
      vanity_url: 'marta-velvet-nails',
      description:
        'Stylistka w Studio Velvet Nails na Mokotowie. Najlepiej czuję się ' +
        'w klasycznym frenchu i naturalnych odcieniach.',
    },
    photos: pick([
      'nail-44-short-cherry-red',
      'nail-48-short-classic-french',
      'hero-nail-16-velvet-cat-eye',
    ]),
    pinnedCount: 2,
    galleryAgeOffsetDays: 50,
  },
  {
    email: 'demo-staff-kasia@example.com',
    profile: {
      business_name: 'Studio Velvet Nails',
      address_city: 'Warszawa',
      vanity_url: 'kasia-velvet-nails',
      description:
        'W Studio Velvet Nails od dwóch lat. Robię szybkie wizyty w przerwie ' +
        'na lunch i zdobienia, które da się nosić do biura.',
    },
    photos: pick([
      'nail-46-medium-tortoiseshell',
      'hero-nail-15-dark-chocolate',
      'nail-49-medium-marble-accent',
    ]),
    pinnedCount: 2,
    galleryAgeOffsetDays: 55,
  },
];
