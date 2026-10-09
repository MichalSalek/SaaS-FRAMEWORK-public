// admin/components/policy-editor.utils.ts — pure draft and list rules of the policies editor.

export interface PolicyEditorState {
  id: string | undefined;
  title: string;
  content: string;
}

/**
 * The editor holds text that is on no saved policy yet.
 * `saved` = the policy the editor is bound to, as last read from the server
 * (null for a new draft, or while a just-created policy is not re-read yet).
 */
export function isPolicyDraftDirty(
  editor: PolicyEditorState,
  saved: { title: string; content: string } | null
): boolean {
  if (editor.id === undefined) {
    return editor.title.trim().length > 0 || editor.content.trim().length > 0;
  }
  if (saved === null) {
    return false;
  }
  return editor.title !== saved.title || editor.content !== saved.content;
}

export const POLICIES_PAGE_SIZE = 10;

/** The main policy leads; the rest keep the server's order. */
export function orderPolicies<T extends { is_main: boolean }>(
  policies: readonly T[]
): T[] {
  return [
    ...policies.filter(policy => policy.is_main),
    ...policies.filter(policy => !policy.is_main),
  ];
}

/** 1-based page of the list that holds `id`; null when it is not listed. */
export function pageOfPolicy(
  ordered: readonly { id: string }[],
  id: string | undefined,
  pageSize: number = POLICIES_PAGE_SIZE
): number | null {
  if (id === undefined) {
    return null;
  }
  const index = ordered.findIndex(policy => policy.id === id);
  return index === -1 ? null : Math.floor(index / pageSize) + 1;
}
