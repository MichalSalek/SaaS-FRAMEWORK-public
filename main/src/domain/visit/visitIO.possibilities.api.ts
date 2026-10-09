import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import { defineEndpoint, defineQuery } from '../../application/http/io';

export const getClientVisits_IO = defineQuery<
  VISIT_DTO_API_V1['GET_CLIENT_VISITS']['REQUEST'],
  VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE'],
  VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_CLIENT_VISITS,
  queryFields: req => ({
    client_user_id: req.client_user_id,
    cursor: req.cursor,
    take: req.take,
  }),
});

export const createManualVisit_IO = defineEndpoint<
  VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['REQUEST'],
  VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['RESPONSE'],
  VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CREATE_MANUAL_VISIT,
  mode: 'post',
});

export const updateVisitNote_IO = defineEndpoint<
  VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['REQUEST'],
  VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['RESPONSE'],
  VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.UPDATE_VISIT_NOTE,
  mode: 'post',
});

export const addVisitResultPhoto_IO = defineEndpoint<
  VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['REQUEST'],
  VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['RESPONSE'],
  VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADD_VISIT_RESULT_PHOTO,
  mode: 'post',
});

export const removeVisitResultPhoto_IO = defineEndpoint<
  VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['REQUEST'],
  VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['RESPONSE'],
  VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.REMOVE_VISIT_RESULT_PHOTO,
  mode: 'post',
});

export const deleteManualVisit_IO = defineEndpoint<
  VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['REQUEST'],
  VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['RESPONSE'],
  VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.DELETE_MANUAL_VISIT,
  mode: 'post',
});

export const getClientCrmNote_IO = defineQuery<
  VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['REQUEST'],
  VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['RESPONSE'],
  VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CLIENT_GET_CRM_NOTE,
  queryFields: req => ({ client_user_id: req.client_user_id }),
});

export const upsertClientCrmNote_IO = defineEndpoint<
  VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['REQUEST'],
  VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['RESPONSE'],
  VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CLIENT_UPSERT_CRM_NOTE,
  mode: 'post',
});

// D4: kasowanie notatki w każdym stanie pary (własne dane stylistki).
export const deleteClientCrmNote_IO = defineEndpoint<
  VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['REQUEST'],
  VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['RESPONSE'],
  VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CLIENT_DELETE_CRM_NOTE,
  mode: 'post',
});
