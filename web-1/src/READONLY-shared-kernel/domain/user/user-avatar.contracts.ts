import { defineContracts } from '../../application/contracts/contract.types';
import {
  userAvatarSetSchema,
  userSetAvatarSchema,
} from './user-avatar.contract-schemas';

export const USER_AVATAR_CONTRACTS = defineContracts({
  USER_SET_AVATAR: {
    summary:
      'Ustawia albo czyści własne zdjęcie użytkownika, niezależnie od roli.',
    group: 'USER',
    kind: 'COMMAND',
    path: 'user/set-avatar',
    method: 'POST',
    body: userSetAvatarSchema,
    query: null,
    response: userAvatarSetSchema,
    successEvents: ['AVATAR_SET', 'AVATAR_CLEARED'],
    auditEvents: ['AVATAR_SET', 'AVATAR_CLEARED'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
});
