import { contractEndpoint } from '../../application/http/io';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';
import { VISIT_CONTRACTS } from '@kernel/domain/visit/visit.contracts';

export const getClientVisits_IO = contractEndpoint(
  VISIT_CONTRACTS.GET_CLIENT_VISITS
);

export const createManualVisit_IO = contractEndpoint(
  VISIT_CONTRACTS.CREATE_MANUAL_VISIT
);

export const updateVisitNote_IO = contractEndpoint(
  VISIT_CONTRACTS.UPDATE_VISIT_NOTE
);

export const addVisitResultPhoto_IO = contractEndpoint(
  VISIT_CONTRACTS.ADD_VISIT_RESULT_PHOTO
);

export const removeVisitResultPhoto_IO = contractEndpoint(
  VISIT_CONTRACTS.REMOVE_VISIT_RESULT_PHOTO
);

export const deleteManualVisit_IO = contractEndpoint(
  VISIT_CONTRACTS.DELETE_MANUAL_VISIT
);

export const getClientCrmNote_IO = contractEndpoint(
  CLIENT_CONTRACTS.CLIENT_GET_CRM_NOTE
);

export const upsertClientCrmNote_IO = contractEndpoint(
  CLIENT_CONTRACTS.CLIENT_UPSERT_CRM_NOTE
);

export const getClientImportantNote_IO = contractEndpoint(
  CLIENT_CONTRACTS.CLIENT_GET_IMPORTANT_NOTE
);

export const upsertClientImportantNote_IO = contractEndpoint(
  CLIENT_CONTRACTS.CLIENT_UPSERT_IMPORTANT_NOTE
);

export const deleteClientCrmNote_IO = contractEndpoint(
  CLIENT_CONTRACTS.CLIENT_DELETE_CRM_NOTE
);
