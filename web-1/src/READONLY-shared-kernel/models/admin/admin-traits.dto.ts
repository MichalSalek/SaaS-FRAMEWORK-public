import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { TraitCategory } from '../db_models.manual.dto';

type CreateColorRequest = {
  name: string;
  hex_code: string;
  display_order?: number;
};

type UpdateColorRequest = {
  color_id: string;
  name?: string;
  hex_code?: string;
  display_order?: number;
  is_active?: boolean;
};

type CreateTraitRequest = {
  name: string;
  category: TraitCategory;
  icon_url?: string;
  display_order?: number;
  is_featured?: boolean;
};

type UpdateTraitRequest = {
  trait_id: string;
  name?: string;
  category?: TraitCategory;
  icon_url?: string;
  display_order?: number;
  is_active?: boolean;
  is_featured?: boolean;
};

export type AdminTraitsDtoApi = {
  /** Tworzy nowy kolor w słowniku (nazwa, hex, kolejność wyświetlania); zwraca color_id. */
  ADMIN_CREATE_COLOR: {
    REQUEST: CreateColorRequest;
    RESPONSE: { color_id: string };
    RESPONSE_ERROR: DetailedErrorPayload<CreateColorRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      CreateColorRequest,
      { color_id: string },
      DetailedErrorPayload<CreateColorRequest>
    >;
  };

  /** Aktualizuje kolor w słowniku po color_id (nazwa, hex, kolejność, aktywność). */
  ADMIN_UPDATE_COLOR: {
    REQUEST: UpdateColorRequest;
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<UpdateColorRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      UpdateColorRequest,
      { success: boolean },
      DetailedErrorPayload<UpdateColorRequest>
    >;
  };

  /** Usuwa kolor ze słownika po color_id. */
  ADMIN_DELETE_COLOR: {
    REQUEST: { color_id: string };
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<{ color_id: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { color_id: string },
      { success: boolean },
      DetailedErrorPayload<{ color_id: string }>
    >;
  };

  /** Tworzy nową cechę w kategorii słownika (ikona, kolejność, wyróżnienie); zwraca trait_id. */
  ADMIN_CREATE_TRAIT: {
    REQUEST: CreateTraitRequest;
    RESPONSE: { trait_id: string };
    RESPONSE_ERROR: DetailedErrorPayload<CreateTraitRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      CreateTraitRequest,
      { trait_id: string },
      DetailedErrorPayload<CreateTraitRequest>
    >;
  };

  /** Aktualizuje cechę słownika po trait_id (nazwa, kategoria, ikona, kolejność, aktywność, wyróżnienie). */
  ADMIN_UPDATE_TRAIT: {
    REQUEST: UpdateTraitRequest;
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<UpdateTraitRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      UpdateTraitRequest,
      { success: boolean },
      DetailedErrorPayload<UpdateTraitRequest>
    >;
  };

  /** Usuwa cechę ze słownika po trait_id. */
  ADMIN_DELETE_TRAIT: {
    REQUEST: { trait_id: string };
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<{ trait_id: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { trait_id: string },
      { success: boolean },
      DetailedErrorPayload<{ trait_id: string }>
    >;
  };
};
