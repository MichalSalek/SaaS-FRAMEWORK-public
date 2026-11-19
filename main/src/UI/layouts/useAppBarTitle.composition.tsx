import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Lets a child page override the title (and optional avatar URL) shown in
 * the `AppLayout` header at runtime. Use `useAppBarTitle()` inside a feature
 * component to set them; the layout subscribes via `AppBarTitleProvider`.
 */
interface AppBarTitleContextValue {
  setTitle: (title: string | null) => void;
  setAvatar: (avatar: string | null) => void;
  setFocusedFlow: (active: boolean) => void;
}

const AppBarTitleContext = createContext<AppBarTitleContextValue | null>(null);

interface AppBarTitleProviderProps {
  value: AppBarTitleContextValue;
  children: ReactNode;
}

export function AppBarTitleProviderComposition({
  value,
  children,
}: AppBarTitleProviderProps) {
  return (
    <AppBarTitleContext.Provider value={value}>
      {children}
    </AppBarTitleContext.Provider>
  );
}

/**
 * Set the layout's AppBar title (and optional avatar) for the lifetime of the
 * calling component. Reverts on unmount.
 *
 * If used outside of `AppLayout`, the call is a no-op (silent) — the hook is
 * safe to call from any page that *might* be wrapped in AppLayout.
 */
export function useAppBarTitle(title: string | null, avatar?: string | null) {
  const ctx = useContext(AppBarTitleContext);

  useEffect(() => {
    if (!ctx) {
      return;
    }
    ctx.setTitle(title);
    ctx.setAvatar(avatar ?? null);
    return () => {
      ctx.setTitle(null);
      ctx.setAvatar(null);
    };
  }, [ctx, title, avatar]);
}

/**
 * Marks the calling screen as a FOCUSED FLOW for as long as `active` is true:
 * the shell hides the bottom navigation, so a step's action bar sits on the
 * screen edge and the only way forward is the step's own button.
 *
 * DECISION: a runtime flag, because the page-level `hideBottomNav` prop cannot
 * express „from the moment a photo is chosen”: the add-a-work wizard is a tab
 * root (nav needed on the empty first step), yet once work is in progress the
 * raised centre tab overlapped the sticky action bar's primary button. The app
 * bar's drawer trigger stays and the wizard has a leave guard, so nobody is
 * trapped.
 */
export function useFocusedFlow(active: boolean) {
  const ctx = useContext(AppBarTitleContext);

  useEffect(() => {
    if (!ctx || !active) {
      return;
    }
    ctx.setFocusedFlow(true);
    return () => ctx.setFocusedFlow(false);
  }, [ctx, active]);
}

/**
 * Hook used by `AppLayout` itself to wire up local state to the provider.
 * Returns `{ title, avatar, providerValue }` — the layout renders `title`
 * + `avatar` and passes `providerValue` down to children.
 *
 * `fallbackTitle` / `brandName` are used ONLY to keep `document.title` in sync
 * with the resolved app-bar title (see the effect below). They do not affect
 * the returned state.
 */
export function useAppBarTitleState(
  fallbackTitle?: string,
  brandName?: string
) {
  const [title, setTitle] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [focusedFlow, setFocusedFlow] = useState(false);

  // DECISION: authed app pages set no <title>, so Next's route announcer read
  // the raw path („/app/shared”) to screen readers and browser tabs stayed
  // empty. The resolved app-bar title is mirrored to document.title, which the
  // announcer reads after this effect. Separator „|”, never a dash or a middle
  // dot (owner).
  const resolvedTitle = title ?? fallbackTitle ?? brandName ?? '';
  useEffect(() => {
    if (!brandName) {
      return;
    }
    document.title =
      resolvedTitle && resolvedTitle !== brandName
        ? `${resolvedTitle} | ${brandName}`
        : brandName;
  }, [resolvedTitle, brandName]);

  const providerValue = useMemo<AppBarTitleContextValue>(
    () => ({ setTitle, setAvatar, setFocusedFlow }),
    []
  );

  return { title, avatar, focusedFlow, providerValue };
}
