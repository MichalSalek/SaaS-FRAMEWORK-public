import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { AdminNote } from '../db_models.generated.dto';

type GetNotesRequest = {
  id?: AdminNote['id'] | undefined;
};

type GetNotesResponse = Pick<AdminNote, 'notes'> & {
  versions: (Pick<AdminNote, 'created_at'> &
    Pick<AdminNote, 'id'> & {
      length: string;
    })[];
};

type SaveNoteRequest = Pick<AdminNote, 'notes'>;

type SetMainNoteRequest = Pick<AdminNote, 'id'>;

export type AdminNotesDtoApi = {
  /** Pobiera treść notatki admina (opcjonalnie konkretnej wersji po id) oraz listę dostępnych wersji. */
  GET_NOTES: {
    REQUEST: GetNotesRequest;
    RESPONSE: GetNotesResponse;
    RESPONSE_ERROR: DetailedErrorPayload<GetNotesRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GetNotesRequest,
      GetNotesResponse,
      DetailedErrorPayload<GetNotesRequest>
    >;
  };

  /** Zapisuje treść notatki admina jako nową wersję; zwraca note_id. */
  SAVE_NOTE: {
    REQUEST: SaveNoteRequest;
    RESPONSE: { note_id: string };
    RESPONSE_ERROR: DetailedErrorPayload<SaveNoteRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SaveNoteRequest,
      { note_id: string },
      DetailedErrorPayload<SaveNoteRequest>
    >;
  };

  /** Oznacza wskazaną (po id) notatkę admina jako główną. */
  SET_MAIN_NOTE: {
    REQUEST: SetMainNoteRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<SetMainNoteRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SetMainNoteRequest,
      undefined,
      DetailedErrorPayload<SetMainNoteRequest>
    >;
  };
};
