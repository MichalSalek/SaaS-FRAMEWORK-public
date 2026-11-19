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
 * Community layer of the demo showcase (2026-09-15): five more stylists on
 * different plans and cities, Ania's salon staff profiles, and two newer clients.
 * With the first showcase that is 10 stylist accounts and 10 client accounts.
 * Photos are only files already in demo-seed (DEMO_PHOTOS_*). New stylists use
 * subsets of Ania's, Ola's and Nina's banks, chosen by file name
 * (demo-content-seeding.bank.ts). Galleries are aged (galleryAgeOffsetDays) so
 * they stay below the earlier showcase in the „Odkrywaj" feed. A shared file is
 * safe to delete: the Cloudinary sink checks whether anyone else still uses it
 * (gallery-cloudinary-cleanup.ts).
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
      'portfolio-sample-001',
      'portfolio-sample-003',
      'portfolio-sample-005',
      'portfolio-sample-009',
      'portfolio-sample-068',
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
      'portfolio-sample-018',
      'portfolio-sample-020',
      'portfolio-sample-022',
      'portfolio-sample-028',
      'portfolio-sample-039',
      'portfolio-sample-047',
      'portfolio-sample-056',
      'portfolio-sample-066',
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
      website: 'https://pracownia-monika.example.com',
      brand_accent_color: brandHex('teal'),
      description:
        'Pracownia w kamienicy przy Piotrkowskiej. Specjalizuję się w ombre, ' +
        'geometrii i mocnych kolorach na długich paznokciach. Terminy układam ' +
        'z dwutygodniowym wyprzedzeniem.',
    },
    photos: pick([
      'portfolio-sample-023',
      'portfolio-sample-004',
      'portfolio-sample-019',
      'portfolio-sample-029',
      'portfolio-sample-035',
      'portfolio-sample-041',
      'portfolio-sample-055',
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
      'portfolio-sample-006',
      'portfolio-sample-021',
      'portfolio-sample-070',
      'portfolio-sample-058',
      'portfolio-sample-065',
      'portfolio-sample-062',
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
      'portfolio-sample-069',
      'portfolio-sample-071',
      'portfolio-sample-057',
      'portfolio-sample-012',
      'portfolio-sample-024',
    ]),
    pinnedCount: 2,
    galleryAgeOffsetDays: 60,
  },
];

/**
 * Ania's salon staff (Marta, Kasia) get a profile card and a few works. The
 * accounts are created in ensureSalonStaff_IO; this is only profile data,
 * filled only into empty fields.
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
      'portfolio-sample-059',
      'portfolio-sample-063',
      'portfolio-sample-014',
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
      'portfolio-sample-061',
      'portfolio-sample-013',
      'portfolio-sample-064',
    ]),
    pinnedCount: 2,
    galleryAgeOffsetDays: 55,
  },
];
