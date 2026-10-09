import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import {
  assertType,
  isTraitCategoryNarrower,
} from '@kernel/models/type_narrowing';

/**
 * Narrow Prisma trait category string to TraitCategory.
 * Runtime-validated via kernel narrower.
 */
export const narrowTraitCategory = (raw: string): TraitCategory =>
  assertType(raw, isTraitCategoryNarrower, 'TraitCategory');

// DECISION (nie usuwaj tego komentarza): SSOT kształtu color/trait dla wszystkich
// query galerii. Selektor + mapper na junction colors/traits był skopiowany 1:1 w 5
// operacjach (explore/list/detail/public/update) — dodanie pola do DTO koloru/traitu
// wymagało ręcznej edycji 5 miejsc (drift-vector). Fragment select + dwa mappery żyją
// tu jako pojedyncze źródło; query spreadują `GALLERY_COLORS_TRAITS_SELECT` do swojego
// `include`/`select` i wołają mappery na wyniku. Kształt wyjściowy mapperów = kontrakt
// DTO (id/name/hex_code dla koloru; id/name/category/icon_url/is_featured dla traitu).

/**
 * Shared Prisma sub-select for the color/trait junctions on GalleryRecord.
 * Spread into a query's `include` (explore/detail/public) or top-level `select`
 * (update/list) — scoped to exactly the columns the DTO mappers below consume.
 */
export const GALLERY_COLORS_TRAITS_SELECT = {
  colors: {
    select: {
      color: {
        select: { id: true, name: true, hex_code: true },
      },
    },
  },
  traits: {
    select: {
      trait: {
        select: {
          id: true,
          name: true,
          category: true,
          icon_url: true,
          is_featured: true,
        },
      },
    },
  },
} as const;

type GalleryColorJunction = {
  color: { id: string; name: string; hex_code: string };
};

type GalleryTraitJunction = {
  trait: {
    id: string;
    name: string;
    category: string;
    icon_url: string | null;
    is_featured: boolean;
  };
};

/**
 * Map GalleryRecord.colors junction rows to the public color DTO shape.
 * Structural input type accepts any Prisma result carrying the needed columns.
 */
export const mapGalleryColors = (
  colors: ReadonlyArray<GalleryColorJunction>
): Array<{ id: string; name: string; hex_code: string }> =>
  colors.map(c => ({
    id: c.color.id,
    name: c.color.name,
    hex_code: c.color.hex_code,
  }));

/**
 * Map GalleryRecord.traits junction rows to the public trait DTO shape,
 * narrowing the raw category string to TraitCategory.
 */
export const mapGalleryTraits = (
  traits: ReadonlyArray<GalleryTraitJunction>
): Array<{
  id: string;
  name: string;
  category: TraitCategory;
  icon_url: string | null;
  is_featured: boolean;
}> =>
  traits.map(t => ({
    id: t.trait.id,
    name: t.trait.name,
    category: narrowTraitCategory(t.trait.category),
    icon_url: t.trait.icon_url,
    is_featured: t.trait.is_featured,
  }));
