import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  COLOR_SEED_DATA,
  TRAIT_SEED_DATA,
} from '@kernel/domain/gallery/gallery.seed';
import { Prisma } from '../../prisma/js-client';

/**
 * Seed Colors and Traits (idempotent)
 *
 * Strategy:
 * - createMany with skipDuplicates for new records
 * - Update existing records (preserve is_active)
 * - Uses batch operations for performance
 */
export const seedGalleryData = async (): Promise<void> => {
  reportIssueBackend({
    mode: 'info',
    namespace: 'gallery-seed',
    message: 'Seeding gallery colors and traits...',
    payload: {},
  });

  // Fixed four-statement seed: two idempotent inserts + two parameterized batch
  // updates. The former implementation issued one updateMany per existing seed
  // row on every production boot (30+ SQL statements).
  const colorsCreated = await DB_CLIENT.use.color.createMany({
    data: [...COLOR_SEED_DATA],
    skipDuplicates: true,
  });
  await DB_CLIENT.use.$executeRaw(Prisma.sql`
    UPDATE "Color" AS target
    SET
      "hex_code" = source.hex_code,
      "display_order" = source.display_order
    FROM (VALUES ${Prisma.join(
      COLOR_SEED_DATA.map(
        color =>
          Prisma.sql`(${color.name}::text, ${color.hex_code}::text, ${color.display_order}::int)`
      )
    )}) AS source(name, hex_code, display_order)
    WHERE target."name" = source.name
  `);

  const traitsCreated = await DB_CLIENT.use.trait.createMany({
    data: [...TRAIT_SEED_DATA],
    skipDuplicates: true,
  });
  await DB_CLIENT.use.$executeRaw(Prisma.sql`
    UPDATE "Trait" AS target
    SET
      "category" = source.category,
      "display_order" = source.display_order,
      "is_featured" = source.is_featured
    FROM (VALUES ${Prisma.join(
      TRAIT_SEED_DATA.map(
        trait =>
          Prisma.sql`(${trait.name}::text, ${trait.category}::text, ${trait.display_order}::int, ${trait.is_featured}::boolean)`
      )
    )}) AS source(name, category, display_order, is_featured)
    WHERE target."name" = source.name
  `);

  const totalCreated = colorsCreated.count + traitsCreated.count;
  const colorsUpdated = COLOR_SEED_DATA.length - colorsCreated.count;
  const traitsUpdated = TRAIT_SEED_DATA.length - traitsCreated.count;
  const totalUpdated = colorsUpdated + traitsUpdated;

  reportIssueBackend({
    mode: 'info',
    namespace: 'gallery-seed',
    message:
      totalCreated > 0 || totalUpdated > 0
        ? `Gallery seed: ${colorsCreated.count} colors created, ${traitsCreated.count} traits created, ${totalUpdated} updated`
        : 'All gallery colors and traits up to date',
    payload: {
      colorsToCreate: colorsCreated.count,
      traitsToCreate: traitsCreated.count,
      totalUpdated,
    },
  });
};
