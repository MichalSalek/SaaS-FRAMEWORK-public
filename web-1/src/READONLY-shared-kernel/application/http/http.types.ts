import type { EVENT_INFO_TYPE } from '../../domain/commands-and-queries/cqrs.types';

export type InfoEventWithPayloadDTO<DataPayload = unknown> = {
  event: EVENT_INFO_TYPE;
  data: DataPayload;
};

export type HTTPError<ErrorPayload> = InfoEventWithPayloadDTO<
  ErrorPayload | undefined
>;

export type HTTPSuccess<ResPayload> = InfoEventWithPayloadDTO<ResPayload>;

export type HTTPErrorCallback<ErrorPayload> = (
  error: HTTPError<ErrorPayload>
) => Promise<void>;

export type HTTPSuccessCallback<ResPayload> = (
  response: HTTPSuccess<ResPayload>
) => Promise<void>;

export type DetailedErrorGeneric = {
  __general: string;
};

export type DetailedErrorPayload<DetailedErrorDTO> = Record<
  keyof DetailedErrorDTO,
  string
> &
  DetailedErrorGeneric;
