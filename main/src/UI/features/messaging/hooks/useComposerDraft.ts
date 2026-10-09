// UI/features/messaging/hooks/useComposerDraft.ts
// Per-conversation composer draft that survives in-app navigation.
//
// Why: the composer text lived in component state, so leaving a thread (back to
// the inbox, a bottom-bar tab, a notification) and coming back threw away a
// half-written message. Worse, the page component stays mounted when the route
// only swaps the id (thread A → thread B), so one `useState` served every
// thread and a failed send was restored into whichever thread was open when the
// request failed.
//
// Scope: module memory, not storage. Drafts live for the tab's lifetime (SPA
// navigation), never touch disk and never outlive a reload. Keys are
// conversation ids that only their own participants can open.
// Consumers: messaging thread composer, support thread compose bar.

import { useCallback, useState } from 'react';

export type ComposerDraftScope = 'messaging' | 'support';

const drafts = new Map<string, string>();

export function composerDraftKey(
  scope: ComposerDraftScope,
  id: string
): string | null {
  return id.length > 0 ? `${scope}:${id}` : null;
}

export function readComposerDraft(key: string): string {
  return drafts.get(key) ?? '';
}

export function writeComposerDraft(key: string, value: string): void {
  if (value.length === 0) {
    drafts.delete(key);
  } else {
    drafts.set(key, value);
  }
}

/**
 * Text of a message that failed to send, put back in front of whatever the
 * user typed meanwhile (the failed message is older, so it goes first).
 */
export function mergeRestoredDraft(failed: string, current: string): string {
  return current.length === 0 ? failed : `${failed}\n${current}`;
}

interface DraftState {
  key: string | null;
  value: string;
}

export function useComposerDraft(key: string | null) {
  const [state, setState] = useState<DraftState>(() => ({
    key,
    value: key === null ? '' : readComposerDraft(key),
  }));

  // Key switch (thread A → B on the same mounted page): adopt B's draft during
  // render, React's "adjust state on prop change" pattern, so A's text never
  // flashes in B's composer for a frame.
  let current = state;
  if (state.key !== key) {
    current = { key, value: key === null ? '' : readComposerDraft(key) };
    setState(current);
  }

  const setValue = useCallback(
    (value: string) => {
      if (key !== null) {
        writeComposerDraft(key, value);
      }
      setState({ key, value });
    },
    [key]
  );

  /** Put a failed message back into the draft of the conversation it was sent to. */
  const restoreInto = useCallback((targetKey: string, failed: string) => {
    const merged = mergeRestoredDraft(failed, readComposerDraft(targetKey));
    writeComposerDraft(targetKey, merged);
    setState(prev =>
      prev.key === targetKey ? { key: targetKey, value: merged } : prev
    );
  }, []);

  /** Drop the draft of a conversation whose message was accepted. */
  const clearFor = useCallback((targetKey: string) => {
    writeComposerDraft(targetKey, '');
    setState(prev =>
      prev.key === targetKey ? { key: targetKey, value: '' } : prev
    );
  }, []);

  return { value: current.value, setValue, restoreInto, clearFor };
}
