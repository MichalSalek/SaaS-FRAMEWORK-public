import { describe, expect, it } from 'vitest';
import {
  resolveErrorFeedbackPolicy,
  shouldAnnounceStaleConnectivity,
} from './error-feedback.policy';

describe('resolveErrorFeedbackPolicy', () => {
  it('silences reads issued by the query cache', () => {
    expect(resolveErrorFeedbackPolicy('get', undefined, true)).toBe(
      'background'
    );
  });

  it('keeps the toast for actions and imperative reads', () => {
    expect(resolveErrorFeedbackPolicy('post', undefined, true)).toBe(
      'foreground'
    );
    expect(resolveErrorFeedbackPolicy('get', undefined, false)).toBe(
      'foreground'
    );
  });

  it('lets an endpoint declare its policy either way', () => {
    expect(resolveErrorFeedbackPolicy('get', 'foreground', true)).toBe(
      'foreground'
    );
    expect(resolveErrorFeedbackPolicy('post', 'background', false)).toBe(
      'background'
    );
  });
});

describe('shouldAnnounceStaleConnectivity', () => {
  it('announces a connectivity failure only over kept data', () => {
    expect(
      shouldAnnounceStaleConnectivity('INTERNET_CONNECTION_PROBLEM', true)
    ).toBe(true);
    expect(
      shouldAnnounceStaleConnectivity('INTERNET_CONNECTION_PROBLEM', false)
    ).toBe(false);
  });

  it('stays silent for business and server errors', () => {
    expect(shouldAnnounceStaleConnectivity('GENERAL_ERROR', true)).toBe(false);
    expect(shouldAnnounceStaleConnectivity(null, true)).toBe(false);
  });
});
