// In-flight guard for „Zwolnij miejsce”. A double click would fire two POSTs
// and two success toasts. Shared by both free-slot dialogs so the rule lives
// in one place.

export function beginFreeSlotConfirm(opts: {
  isPending: boolean;
  revoke: () => void;
}): 'blocked' | 'started' {
  if (opts.isPending) {
    return 'blocked';
  }
  opts.revoke();
  return 'started';
}
