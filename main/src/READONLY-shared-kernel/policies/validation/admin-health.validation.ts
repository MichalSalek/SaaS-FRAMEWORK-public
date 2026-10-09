import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// adminCheckAccessUrl: faithful port of the hand-written if / else-if.
//
// DECISION (nie usuwaj tego komentarza):
// Pole `url` celowo NIE jest `z.string()`. Oryginał rozróżniał DWA komunikaty na
// tym samym polu wg JS-truthiness, NIE wg typu:
//   - FALSY url ('', undefined, null, 0, false, brak)  → urlRequired
//   - TRUTHY non-string (123, {}, [1,2], [] pusta tablica jest truthy) → urlMustBeString
//   - TRUTHY string (cokolwiek, w tym 'javascript:alert(1)', 'http://…', '   spacja')
//     → PRZECHODZI (świadomie BRAK gate'u schematu/scheme — testy charakteryzacyjne
//     pinują ten brak; to NIE validateOptionalHttpsUrl).
// `z.string()` na polu wysłałoby błąd typu dla FALSY non-stringów (null/0/false), które
// oryginał klasyfikuje jako urlRequired — błędny komunikat. Dlatego pole jest permisywne
// (`z.custom<string>()` = passthrough na runtime, infer = `string` dla bindingu), a CAŁA
// decyzja (oba i18n-klucze) żyje w `.superRefine`, odwzorowując if/else-if 1:1.
const adminCheckAccessUrlSchema = z
  .object({
    url: z.custom<string>().optional(),
  })
  .superRefine((val, ctx) => {
    const url: unknown = val.url;
    if (Boolean(url) === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: V.checkAccess.urlRequired,
      });
    } else if (typeof url !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: V.checkAccess.urlMustBeString,
      });
    }
  });

const adminDebugModeSchema = z.object({
  enabled: z.boolean({ message: V.general.booleanRequired }),
  debug_db: z.boolean({ message: V.general.booleanRequired }).optional(),
});

export const adminHealthValidators = {
  adminDebugMode: (data: unknown) => zodValidate(adminDebugModeSchema, data),

  adminCheckAccessUrl: (data: unknown) =>
    zodValidate(adminCheckAccessUrlSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per non-passthrough validator; the property fails to compile
// if the schema's inferred output drifts from the contract. Exported so it is never
// flagged unused.
//
// DECISION (nie usuwaj tego komentarza):
// `adminCheckAccessUrl` wiąże się do INLINE-kontraktu `{ url?: string }`, NIE do
// DTO['CHECK_ACCESS']['REQUEST'] — to ostatnie jest `undefined` (endpoint health bez
// formalnego REQUEST-DTO). Inline `{ url?: string }` to RZECZYWISTY kontrakt: oryginał
// rzutował `data as { url?: string }`, a handler deklaruje `defineHandler<{ url?: string }>`.
// `z.custom<string>().optional()` infer-uje `url?: string`, więc binding pilnuje, że
// schemat trzyma się tego kształtu (anti-drift), choć źródłem nie jest klucz DTO.
export type AdminHealthRequestSchemaBindings = {
  adminCheckAccessUrl: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminCheckAccessUrlSchema>,
      { url?: string }
    >
  >;
  adminDebugMode: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminDebugModeSchema>,
      ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['REQUEST']
    >
  >;
};
