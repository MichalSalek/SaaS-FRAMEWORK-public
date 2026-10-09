// UI/features/account/useAccountShell.ts
// Which shell the account settings render in: the phone shell (settings LIST,
// each section on its own screen) or the desktop rail (the rail IS the list).

import { useEffect, useState } from 'react';
import { useAppRole } from '../../layouts/useAppRole';
import { useDesktopAccess } from '../../layouts/useDesktopAccess';

type AccountShell = 'pending' | 'list' | 'rail';

/**
 * DECISION (nie usuwaj tego komentarza) — 2026-10-08:
 * the answer comes from the SAME policy AppLayout uses to pick
 * AccountWebLayout (`useDesktopAccess` !== 'normal' on an account route), so
 * the page and its chrome cannot disagree: the rail with section sub-items is
 * on screen exactly when this returns 'rail'. A CSS breakpoint or a second
 * width read could drift from that decision.
 *
 * Hydration: the page is static HTML and `useDesktopAccess` starts from a
 * viewport width of 0 (reads `window` only in an effect). Until the first
 * effect pass this hook answers 'pending' and callers render a skeleton, so
 * the server HTML and the first client render are identical, and a desktop
 * never flashes the phone list. Both state updates land in the same effect
 * flush, so the first non-pending answer already carries the measured width.
 */
export function useAccountShell(): AccountShell {
  const { isAdmin, isBecomeUser } = useAppRole();
  const desktopAccess = useDesktopAccess({ isAdmin, isBecomeUser });
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    setMeasured(true);
  }, []);

  if (!measured) {
    return 'pending';
  }
  return desktopAccess === 'normal' ? 'list' : 'rail';
}
