// domain/session-container/sessionContainerIO.possibilities.api.ts
// IO functions for the Session Container API.
// Stack: contract endpoints. The `_IO` names are kept.
// See the DECISION in `application/http/io.ts`.

import { contractEndpoint } from '../../application/http/io';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export const getMySessionContainers_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_GET_MY
);

export const createSessionContainer_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_CREATE
);

export const getSessionContainerById_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_GET_BY_ID
);

export const shareSessionContainer_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_SHARE
);

export const acceptSessionContainer_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_ACCEPT
);

export const closeSessionContainer_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_CLOSE
);

export const setSessionContainerNote_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_SET_NOTE
);

export const addPhotoToSessionContainer_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_ADD_PHOTO
);

export const removePhotoFromSessionContainer_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_REMOVE_PHOTO
);

export const getSessionInsights_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_INSIGHTS
);

export const duplicateSessionContainer_IO = contractEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_DUPLICATE
);
