import type { HTTPErrorCallback, HTTPSuccessCallback } from './http.types';

// @Req Request payload
// @Res Response data
// @Err Error payload
export type IOClientFunctionReqResErr<Req, Res, Err> = (
  req: Req,
  successCallback: HTTPSuccessCallback<Res>,
  errorCallback: HTTPErrorCallback<Err>
) => Promise<void>;
