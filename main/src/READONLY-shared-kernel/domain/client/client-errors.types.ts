export type ClientNotFoundError = {
  type: 'CLIENT_NOT_FOUND';
  clientId: string;
};

export type ClientUnauthorizedAccessError = {
  type: 'CLIENT_UNAUTHORIZED_ACCESS';
  clientId: string;
  stylistAccountId: string;
};

export type ClientError = ClientNotFoundError | ClientUnauthorizedAccessError;
