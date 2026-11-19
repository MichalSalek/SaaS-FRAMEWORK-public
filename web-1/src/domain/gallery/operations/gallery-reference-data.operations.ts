import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import { narrowTraitCategory } from '@domain/gallery/gallery.utils.api';
import { databaseFailure } from '@app/errors/error-result.helpers';

type ColorEntry = { id: string; name: string; hex_code: string };
type TraitEntry = {
  id: string;
  name: string;
  category: TraitCategory;
  icon_url: string | null;
  is_featured: boolean;
};

/**
 * Get all active colors for gallery
 */
export const getActiveColors_IO = async (): Promise<
  OperationResult<ColorEntry[], DatabaseError>
> => {
  try {
    const colors = await DB_CLIENT.use.color.findMany({
      where: { is_active: true },
      select: { id: true, name: true, hex_code: true },
      orderBy: { display_order: 'asc' },
      take: 500,
    });

    return success(colors);
  } catch (error) {
    return databaseFailure('getActiveColors', error);
  }
};

/**
 * Get all active traits, optionally filtered by category
 */
export const getActiveTraits_IO = async ({
  category,
}: {
  category?: TraitCategory;
}): Promise<OperationResult<TraitEntry[], DatabaseError>> => {
  try {
    const traits = await DB_CLIENT.use.trait.findMany({
      where: {
        is_active: true,
        ...(category ? { category } : {}),
      },
      select: {
        id: true,
        name: true,
        category: true,
        icon_url: true,
        is_featured: true,
      },
      orderBy: [
        { is_featured: 'desc' },
        { category: 'asc' },
        { display_order: 'asc' },
      ],
      take: 500,
    });

    const narrowed: TraitEntry[] = traits.map(t => ({
      ...t,
      category: narrowTraitCategory(t.category),
    }));
    return success(narrowed);
  } catch (error) {
    return databaseFailure('getActiveTraits', error);
  }
};
