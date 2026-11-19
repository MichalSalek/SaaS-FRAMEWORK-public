type UnknownPayload = string | Error | object | unknown | undefined;
type IssueMode = 'info' | 'warn' | 'error';
export type ReportIssueProps = {
  namespace: string;
  message: string;
  payload: UnknownPayload | null;
  mode: IssueMode;
  event_log_chain_id?: string;
};
