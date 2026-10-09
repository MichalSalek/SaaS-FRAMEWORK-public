// UI/primitives/overlayContainer.context.ts
// Kontener portalu dla nakładek modalnych (AppDialog).
//
// DECISION (nie usuwaj tego komentarza): dialog domyślnie portaluje się do
// `document.body` i centruje na CAŁYM oknie. Na desktopie trasy produktowe
// renderują się w makiecie telefonu (AppLayout, `desktopAccess === 'frame'`,
// 390x844), więc każdy dialog wychodził poza obudowę i nachodził na panel
// „Podgląd mobilny" obok. To NIE była przypadłość skanera — dotyczyła każdego
// dialogu na trasie produktowej, dlatego naprawa siedzi we wspólnej prymitywie,
// a nie w jednym widoku.
//
// `null` = zachowanie domyślne (portal do `document.body`). Kontener podaje
// wyłącznie AppLayout w trybie ramki; w każdym innym drzewie (mobile, admin,
// AccountWebLayout, strony publiczne) nic się nie zmienia.

import { createContext, useContext } from 'react';

export const OverlayContainerContext = createContext<HTMLElement | null>(null);

export function useOverlayContainer(): HTMLElement | null {
  return useContext(OverlayContainerContext);
}
