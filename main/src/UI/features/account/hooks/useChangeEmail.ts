// UI/features/account/hooks/useChangeEmail.ts
// TQ v5 mutation -- POST /api/v1/user/change-email
// Requests an email change for the current user. Backend sends a verification
// link to the NEW email; user clicks it → email changed + session invalidated.
// Stack: TanStack Query v5.

import { useMutation } from '@tanstack/react-query';
import { changeEmail_IO } from '../../../../domain/user/userIO.possibilities.api';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

/* ─── Types ─── */

type ChangeEmailRequest =
  USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['REQUEST'];

/* ─── Hook ─── */

export function useChangeEmail() {
  return useMutation({
    mutationFn: (req: ChangeEmailRequest) => changeEmail_IO(req),
    meta: { suppressGlobalError: true },
  });
}
