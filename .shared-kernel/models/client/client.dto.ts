import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { ClientAccount } from '../db_models.generated.dto';

export type CLIENT_DTO_API_V1 = {
  /** Aktualizuje dane kontaktowe klientki (telefon albo email); zwraca zapisane wartości. */
  CLIENT_UPDATE_CONTACT: {
    REQUEST: Partial<Pick<ClientAccount, 'contact_phone' | 'contact_email'>>;
    RESPONSE: {
      success: true;
    } & Pick<ClientAccount, 'contact_phone' | 'contact_email'>;
    RESPONSE_ERROR: DetailedErrorPayload<{
      error: 'VALIDATION_FAILED' | 'NOT_CLIENT_ACCOUNT';
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'],
      CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['RESPONSE'],
      CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca profil kontaktowy bieżącej klientki (telefon, email, data utworzenia). */
  CLIENT_GET_PROFILE: {
    REQUEST: Record<string, never>;
    RESPONSE: Pick<ClientAccount, 'contact_phone' | 'contact_email'> & {
      created_at: string; // wire format
    };
    RESPONSE_ERROR: DetailedErrorPayload<{
      error: 'NOT_CLIENT_ACCOUNT' | 'PROFILE_NOT_FOUND';
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['REQUEST'],
      CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE'],
      CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE_ERROR']
    >;
  };

  /** Udostępnia stylistce dane kontaktowe sparowanej klientki (telefon, email, imię) po jej identyfikatorze. */
  CLIENT_GET_CONTACT_FOR_STYLIST: {
    REQUEST: {
      client_user_id: string;
    };
    RESPONSE: {
      contact_phone: string | null;
      contact_email: string | null;
      client_name: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<{
      error:
        'NOT_PAIRED_WITH_CLIENT' | 'PROFILE_NOT_FOUND' | 'NOT_STYLIST_ACCOUNT';
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['REQUEST'],
      CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE'],
      CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE_ERROR']
    >;
  };
};
