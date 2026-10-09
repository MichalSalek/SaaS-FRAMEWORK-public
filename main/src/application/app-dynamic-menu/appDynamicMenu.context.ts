import { createContext } from 'react';
import type { AppDynamicMenuButton } from './appDynamicMenu.types';

export type AppDynamicMenuContextType = {
  activeActionsButtons: AppDynamicMenuButton[];
  setActiveActionsButtons: (
    activeActionsButtons: AppDynamicMenuButton[]
  ) => void;
};

const appDynamicMenuContextInitialValue: AppDynamicMenuContextType = {
  activeActionsButtons: [],
  setActiveActionsButtons: () => undefined,
};

export const AppDynamicMenuContext = createContext<AppDynamicMenuContextType>(
  appDynamicMenuContextInitialValue
);
