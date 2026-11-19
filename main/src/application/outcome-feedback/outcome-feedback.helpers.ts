export type SaveFeedbackState =
  'idle' | 'dirty' | 'pending' | 'complete' | 'error';
export interface SaveFeedbackEvidence {
  pending: boolean;
  failed: boolean;
  dirty: boolean;
  acknowledged: boolean;
}
/** Only the acknowledged latest version is complete; queued writes remain pending. */
export const resolveSaveFeedbackState = ({
  pending,
  failed,
  dirty,
  acknowledged,
}: SaveFeedbackEvidence): SaveFeedbackState =>
  pending
    ? 'pending'
    : failed
      ? 'error'
      : dirty
        ? 'dirty'
        : acknowledged
          ? 'complete'
          : 'idle';
