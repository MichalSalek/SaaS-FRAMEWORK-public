// UI/features/account/accountSections.icons.ts
// Icon of every account settings section. The section list itself is pure
// (application/policies/account-sections.config.ts); icons are a UI concern.

import {
  BellIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  PaletteIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  WarningOctagonIcon,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { AccountSectionId } from '../../../application/policies/account-sections.config';

export const ACCOUNT_SECTION_ICONS: Readonly<
  Record<AccountSectionId, PhosphorIcon>
> = {
  account: UserCircleIcon,
  notifications: BellIcon,
  appearance: PaletteIcon,
  activity: ClockCounterClockwiseIcon,
  security: ShieldCheckIcon,
  data: DatabaseIcon,
  danger: WarningOctagonIcon,
};
