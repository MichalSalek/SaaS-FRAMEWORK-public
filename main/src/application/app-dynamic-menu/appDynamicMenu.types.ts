import type { JSX } from 'react';

type IconProps = Record<string, unknown>;

export type AppDynamicMenuButton = {
  title: string;
  action: () => void;
  icon: (props?: IconProps) => JSX.Element;
};
