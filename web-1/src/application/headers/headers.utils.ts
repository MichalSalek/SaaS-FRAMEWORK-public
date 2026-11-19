import type { ValueOf } from '@msalek/utils';
import type { NextApiWithOptionalPayload } from '@app/http/http.types';
import type { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

export const setClientHeader = (
  props: NextApiWithOptionalPayload<{
    name: ValueOf<typeof CUSTOM_HEADERS>;
    value: string;
  }>
) => {
  const { res, payload } = props;

  if (!payload) {
    return;
  }

  res.setHeader(payload.name, payload.value);
};

export const getClientHeader = async (
  props: NextApiWithOptionalPayload<string>
) => {
  const { req, payload } = props;

  if (!payload) {
    return null;
  }

  const raw = req.headers[payload];
  const outputHeader = Array.isArray(raw) ? raw[0] : raw;

  if (!outputHeader) {
    return null;
  }

  return outputHeader;
};
