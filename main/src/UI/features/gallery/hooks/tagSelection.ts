// UI/features/gallery/hooks/tagSelection.ts
// Pure selection reducers shared by the upload wizard (step 2) and the photo
// edit modal. Kept pure so the cap rule is unit-tested in one place.

/** Toggle an id in/out of a list with no cap (traits). */
export function toggleSelection(prev: string[], id: string): string[] {
  return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
}

/**
 * Toggle an id with a cap (colors, max 3). A selected id is always removable;
 * adding past the cap returns `prev` unchanged. The UI disables unselected
 * options at the cap (`isSelectionFull`), so this branch is a safety net, not
 * the user-facing behaviour.
 */
export function toggleCappedSelection(
  prev: string[],
  id: string,
  max: number
): string[] {
  if (prev.includes(id)) {
    return prev.filter(x => x !== id);
  }
  if (prev.length >= max) {
    return prev;
  }
  return [...prev, id];
}

/** True when no further id can be added (unselected options render disabled). */
export function isSelectionFull(selected: readonly string[], max: number) {
  return selected.length >= max;
}
