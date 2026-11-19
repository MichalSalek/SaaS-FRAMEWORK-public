// UI/primitives/overlayContainer.context.ts
// Portal container for modal overlays (AppDialog, AppSheet).
//
// DECISION: on desktop, product routes render inside a phone frame (AppLayout,
// `desktopAccess === 'frame'`), and a dialog portalled to `document.body`
// centred on the whole window, outside the frame. The fix lives in the shared
// primitive because it affects every dialog on a product route. Only AppLayout
// in frame mode provides a container; `null` = default portal to the body
// (consumers pass it on as `undefined`, see AppDialog.atom.tsx).

import { createContext, useContext } from 'react';

export const OverlayContainerContext = createContext<HTMLElement | null>(null);

export function useOverlayContainer(): HTMLElement | null {
  return useContext(OverlayContainerContext);
}
