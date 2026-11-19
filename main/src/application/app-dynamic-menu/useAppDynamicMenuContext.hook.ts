import { useState, useMemo } from 'react';
import type { AppDynamicMenuContextType } from './appDynamicMenu.context';

export const useAppDynamicMenuContext = (): AppDynamicMenuContextType => {
  const [activeActionsButtons, setActiveActionsButtons] = useState<
    AppDynamicMenuContextType['activeActionsButtons']
  >([]);

  return useMemo(
    () => ({
      activeActionsButtons,
      setActiveActionsButtons,
    }),
    [activeActionsButtons]
  );
};
