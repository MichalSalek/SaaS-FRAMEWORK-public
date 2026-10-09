import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { AdminDuplicateResourceNameError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { hasCode } from '@kernel/models/type_narrowing';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';

/**
 * Update-field allowlists for admin Color / Trait mutations.
 *
 * DECISION (nie usuwaj): allowlist-pick mutowalnych pol update zamiast rest-spread
 * calego request body. Bez tego mass-assignment (OWASP API3/API6): atakujacy admin
 * nadpisuje system-managed PK (`id`) / `created_at`, wstrzykuje cross-model kolumny
 * (np. `is_featured` na Color -> PrismaClientValidationError -> 500), albo wywoluje
 * PK-collision -> P2002 mislabeled jako duplicate-name z pustym `name`. Walidator
 * (admin-traits.validation) sprawdza tylko ZNANE pola gdy obecne i NIE odrzuca
 * nadmiarowych kluczy, a HTTP middleware przekazuje surowe req.body — wiec filtrowanie
 * MUSI byc w warstwie operacji (mirror konwencji createColor_IO / createTrait_IO,
 * ktore jawnie pickuja pola). Pola `undefined` sa pomijane (Prisma traktuje undefined
 * jako no-op), wiec partial update dziala bez nadpisywania niewyslanych kolumn.
 *
 * SSOT mutowalnych pol: schema.prisma model Color / Trait (z wykluczeniem `id`,
 * `created_at` oraz relacji). Przy dodaniu nowej mutowalnej kolumny — dopisz TUTAJ.
 */

export const pickColorUpdateFields = (data: {
  name?: string;
  hex_code?: string;
  display_order?: number;
  is_active?: boolean;
}) => ({
  ...(data.name !== undefined && { name: data.name }),
  ...(data.hex_code !== undefined && { hex_code: data.hex_code }),
  ...(data.display_order !== undefined && {
    display_order: data.display_order,
  }),
  ...(data.is_active !== undefined && { is_active: data.is_active }),
});

export const pickTraitUpdateFields = (data: {
  name?: string;
  category?: TraitCategory;
  icon_url?: string;
  display_order?: number;
  is_active?: boolean;
  is_featured?: boolean;
}) => ({
  ...(data.name !== undefined && { name: data.name }),
  ...(data.category !== undefined && { category: data.category }),
  ...(data.icon_url !== undefined && { icon_url: data.icon_url }),
  ...(data.display_order !== undefined && {
    display_order: data.display_order,
  }),
  ...(data.is_active !== undefined && { is_active: data.is_active }),
  ...(data.is_featured !== undefined && { is_featured: data.is_featured }),
});

export const dupNameError = (
  resourceType: 'COLOR' | 'TRAIT',
  name: string | undefined
): AdminDuplicateResourceNameError => ({
  type: 'ADMIN_DUPLICATE_RESOURCE_NAME',
  resourceType,
  name: name ?? '',
});

/**
 * Case-insensitive name-conflict pre-check dla admin Color / Trait.
 *
 * DECISION (nie usuwaj): kolizja case-variant (Red / RED / red) lapana app-level
 * pre-checkiem (findFirst name mode:'insensitive'), bo @unique na `name` jest byte-exact
 * i przepuscilby je jako rozne wiersze. Storage zachowuje oryginalna pisownie taksonomii
 * (NIE lowercase'ujemy) — pre-check tylko WYKRYWA kolizje, nie kanonikalizuje. excludeId =
 * pomin biezacy rekord przy update (rename na wlasna wartosc != kolizja). rawName undefined
 * (partial update bez `name`) -> brak checku. Trim mirroruje normalizeName z operacji.
 *
 * NIE redundancja z P2002 catch-tail (i NIE over-engineering mimo extra findFirst):
 * pre-check + @unique chronia ROZNE klasy duplikatow. @unique(name) jest byte-exact —
 * lapie WYLACZNIE identyczne 'Red' vs 'Red'; case-variant 'Red' vs 'RED' przeszedlby
 * przez DB jako dwa legalne wiersze. Jedyne miejsce gdzie kolizja case-variant jest
 * wykrywana to ten findFirst insensitive. To deliberate product UX: slownik koloru/
 * cechy jest user-facing (picker), wiec 'Red' i 'RED' jako dwa wpisy = bug widoczny dla
 * stylistki. Jeden extra read na admin-only low-volume mutacje to akceptowalny koszt
 * tej gwarancji (NIE da sie jej dostarczyc samym byte-exact @unique). TOCTOU: pre-check
 * i write nie sa atomowe — dlatego byte-exact @unique + P2002 catch-tail zostaja jako
 * backstop na exact-dup race. Pelna DB-level case-insensitivity (func-index LOWER(name))
 * = osobna migracja, odlozona; do tego czasu ten pre-check jest JEDYNYM strazikiem
 * case-variant i NIE wolno go usuwac jako rzekomego duplikatu P2002.
 */
type Finder = (w: {
  name: { equals: string; mode: 'insensitive' };
  id?: { not: string };
}) => Promise<{ id: string } | null>;
const nameConflict =
  (find: Finder, resourceType: 'COLOR' | 'TRAIT') =>
  async (
    rawName: string | undefined,
    excludeId?: string
  ): Promise<AdminDuplicateResourceNameError | null> => {
    if (rawName === undefined) {
      return null;
    }
    const found = await find({
      // escapeLikePattern: `equals` + mode:'insensitive' compiles to ILIKE — escape so the
      // uniqueness check matches the name LITERALLY (a `%`/`_` in a name must not act as a
      // wildcard) and a trailing `\` cannot crash the check with an unmapped 500.
      name: { equals: escapeLikePattern(rawName.trim()), mode: 'insensitive' },
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    });
    return found !== null ? dupNameError(resourceType, rawName) : null;
  };
export const colorNameConflict = nameConflict(
  w => DB_CLIENT.use.color.findFirst({ where: w, select: { id: true } }),
  'COLOR'
);
export const traitNameConflict = nameConflict(
  w => DB_CLIENT.use.trait.findFirst({ where: w, select: { id: true } }),
  'TRAIT'
);

// DECISION (nie usuwaj): P2002 na Color/Trait = WYLACZNIE kolizja `name` (jedyny @unique;
// PK `id` nie jest mass-assignable po pickColorTraitUpdateFields). `name` zawsze wypelnione
// gdy branch wystrzeli; `?? ''` w dupNameError to defensywny no-op. Ten catch-tail zostaje
// jako backstop dla exact-dup / TOCTOU (race pomiedzy pre-checkiem a write) — color/
// traitNameConflict lapie case-variant zawczasu, ale byte-exact @unique to ostatnia linia.
const isP2002 = (e: unknown): boolean => hasCode(e) && e.code === 'P2002';
export const dbOrDupFailure = (
  e: unknown,
  resourceType: 'COLOR' | 'TRAIT',
  name: string | undefined,
  operation: string
): OperationResult<never, AdminDuplicateResourceNameError | DatabaseError> =>
  isP2002(e)
    ? failure(dupNameError(resourceType, name))
    : databaseFailure(operation, e);
