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

// DECISION: single source for the color/trait shape of all gallery queries. The junction select and
// mapper used to be copied into five operations (explore/list/detail/public/update), so a new DTO field
// meant five manual edits. Queries spread `GALLERY_COLORS_TRAITS_SELECT` into their include/select and
// call the mappers on the result; the mappers' output shape is the DTO contract (color: id/name/hex_code;
// trait: id/name/category/icon_url/is_featured).

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
