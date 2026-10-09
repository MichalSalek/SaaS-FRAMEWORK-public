// UI/features/auth/hooks/useDeleteSelf.ts
// TQ v5 mutation — POST /api/v1/user/delete/self
// Sends a confirmation email; the caller shows a "check your inbox" screen.
// Stack: TanStack Query v5 + unified io.ts front-door (promise-first).

import { useMutation } from '@tanstack/react-query';
import { deleteUserSelf_IO } from '../../../../domain/user/userIO.possibilities.api';

// Brak onSuccess-redirectu: backend odpowiada USER_DELETE_REQUESTED (flow
// z potwierdzeniem mailem), a przejście na krok „sprawdź skrzynkę" robi strona.
export function useDeleteSelf() {
  return useMutation({
    mutationFn: () => deleteUserSelf_IO({}),
    meta: { suppressGlobalError: true },
  });
}
