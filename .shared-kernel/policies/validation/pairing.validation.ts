import type { z } from 'zod';
import type { PAIRING_DTO_API_V1 } from '../../models/pairing/pairing.dto';
import {
  pairRequestCancelSchema,
  pairRequestCreateSchema,
  pairRequestRespondSchema,
  pairingResolvePlaceSchema,
  pairingClaimSessionSchema,
  pairingGetAccessStatusSchema,
  pairingRevokeAccessSchema,
  pairingRevokeSessionSchema,
} from '../../domain/pairing/pairing.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

// DECISION: pairing request schemas live in the API contracts
// (`domain/pairing/pairing.contracts.ts`). These names stay as the legacy view
// (VALIDATION_POLICY, characterization tests). `pairingGetAccessStatus` is the
// exception: the GET answers `{ stylist_account_id: 'Required' }` from the handler,
// so that schema is not the route parser.
// Test: web-1/src/test-utils/integration/pairing-contract.test.ts (missing, empty
// and a repeated id are 400 and do not call the operation).
export const pairingValidators = {
  pairingClaimSession: (data: unknown) =>
    zodValidate(pairingClaimSessionSchema, data),
  pairingRevokeSession: (data: unknown) =>
    zodValidate(pairingRevokeSessionSchema, data),
  pairingRevokeAccess: (data: unknown) =>
    zodValidate(pairingRevokeAccessSchema, data),
  pairingGetAccessStatus: (data: unknown) =>
    zodValidate(pairingGetAccessStatusSchema, data),
  pairRequestCreate: (data: unknown) =>
    zodValidate(pairRequestCreateSchema, data),
  pairingResolvePlace: (data: unknown) =>
    zodValidate(pairingResolvePlaceSchema, data),
  pairRequestRespond: (data: unknown) =>
    zodValidate(pairRequestRespondSchema, data),
  pairRequestCancel: (data: unknown) =>
    zodValidate(pairRequestCancelSchema, data),
} as const;

// Compile-time REQUEST-DTO binding for commands. A drifted command schema fails
// the build. The unused GET schema is not bound: the generated REQUEST is the
// query input, and this schema is not that parser.
export type PairingRequestSchemaBindings = {
  pairingClaimSession: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingClaimSessionSchema>,
      PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['REQUEST']
    >
  >;
  pairingRevokeSession: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingRevokeSessionSchema>,
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['REQUEST']
    >
  >;
  pairingRevokeAccess: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingRevokeAccessSchema>,
      PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['REQUEST']
    >
  >;
  pairRequestCreate: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairRequestCreateSchema>,
      PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['REQUEST']
    >
  >;
  pairRequestRespond: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairRequestRespondSchema>,
      PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['REQUEST']
    >
  >;
  pairRequestCancel: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairRequestCancelSchema>,
      PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['REQUEST']
    >
  >;
  pairingResolvePlace: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingResolvePlaceSchema>,
      PAIRING_DTO_API_V1['PAIRING_RESOLVE_PLACE']['REQUEST']
    >
  >;
};
