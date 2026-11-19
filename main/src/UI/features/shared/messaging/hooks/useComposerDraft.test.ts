import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  composerDraftKey,
  mergeRestoredDraft,
  readComposerDraft,
  useComposerDraft,
  writeComposerDraft,
} from './useComposerDraft';

describe('composer draft store', () => {
  it('has no key until the route id resolves', () => {
    expect(composerDraftKey('messaging', '')).toBeNull();
    expect(composerDraftKey('messaging', 'p1')).toBe('messaging:p1');
    expect(composerDraftKey('support', 'p1')).toBe('support:p1');
  });

  it('forgets a draft written as empty', () => {
    writeComposerDraft('messaging:forget', 'hello');
    writeComposerDraft('messaging:forget', '');
    expect(readComposerDraft('messaging:forget')).toBe('');
  });

  it('puts a failed message before text typed meanwhile', () => {
    expect(mergeRestoredDraft('failed', '')).toBe('failed');
    expect(mergeRestoredDraft('failed', 'newer')).toBe('failed\nnewer');
  });
});

describe('useComposerDraft', () => {
  it('survives an unmount (leaving the thread and coming back)', () => {
    const first = renderHook(() => useComposerDraft('messaging:survive'));
    act(() => first.result.current.setValue('half written'));
    first.unmount();

    const second = renderHook(() => useComposerDraft('messaging:survive'));
    expect(second.result.current.value).toBe('half written');
  });

  it('switches drafts with the key on the same mounted page', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useComposerDraft(`messaging:${id}`),
      { initialProps: { id: 'switch-a' } }
    );
    act(() => result.current.setValue('for A'));

    rerender({ id: 'switch-b' });
    expect(result.current.value).toBe('');
    act(() => result.current.setValue('for B'));

    rerender({ id: 'switch-a' });
    expect(result.current.value).toBe('for A');
  });

  it('restores a failed send into the thread it was sent to, not the open one', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useComposerDraft(`messaging:${id}`),
      { initialProps: { id: 'restore-a' } }
    );
    rerender({ id: 'restore-b' });

    act(() => result.current.restoreInto('messaging:restore-a', 'lost msg'));
    expect(result.current.value).toBe('');
    expect(readComposerDraft('messaging:restore-a')).toBe('lost msg');

    rerender({ id: 'restore-a' });
    expect(result.current.value).toBe('lost msg');
  });

  it('clears the draft of a conversation whose message was accepted', () => {
    const { result } = renderHook(() => useComposerDraft('support:clear'));
    act(() => result.current.setValue('reply'));
    act(() => result.current.clearFor('support:clear'));
    expect(result.current.value).toBe('');
    expect(readComposerDraft('support:clear')).toBe('');
  });
});
