import type { NextApiRequest, NextApiResponse } from 'next';

export type {
  InfoEventWithPayloadDTO,
  HTTPError,
  HTTPSuccess,
  HTTPErrorCallback,
  HTTPSuccessCallback,
  DetailedErrorGeneric,
  DetailedErrorPayload,
} from '@kernel/application/http/http.types';

export type NextApiWithOptionalPayload<T = unknown> = {
  payload?: T;
  req: NextApiRequest;
  res: NextApiResponse;
};
