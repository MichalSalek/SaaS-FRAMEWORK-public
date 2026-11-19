// UI/features/account/UserActivityPage.events-map.tsx
// Pure data: raw EVENTS_ALL_TYPE → VisualSpec lookup table.
// Split from .events.tsx to keep both files under the 300 LOC ceiling.
// Adding a new event = one row here.

import {
  CalendarBlankIcon,
  CameraIcon,
  CreditCardIcon,
  DownloadIcon,
  ImageIcon,
  LinkIcon,
  MapPinIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  ShieldWarningIcon,
  SignInIcon,
  SignOutIcon,
  TrashIcon,
  TrendUpIcon,
  UserPlusIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENTS_ALL_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { VisualSpec } from './UserActivityPage.events';

const I = APP_EVENTS.INFO;
const P = { size: 16, weight: 'bold' as const };

export const FALLBACK_SPEC: VisualSpec = {
  icon: <CalendarBlankIcon {...P} />,
  color: 'muted',
  category: 'account',
  titleKey: 'humanFallback',
};

// prettier-ignore
export const EVENT_MAP: Readonly<Partial<Record<EVENTS_ALL_TYPE, VisualSpec>>> = {
  // Login / sessions
  [I.USER.USER_LOGGED_IN]:            { icon: <SignInIcon {...P} />,         color: 'success', category: 'login',    titleKey: 'humanLoggedIn' },
  [I.USER.DEV_LOGIN_SUCCESS]:         { icon: <SignInIcon {...P} />,         color: 'success', category: 'login',    titleKey: 'humanLoggedIn' },
  [I.USER.USER_LOGGED_OUT]:           { icon: <SignOutIcon {...P} />,        color: 'muted',   category: 'login',    titleKey: 'humanLoggedOut' },
  [I.USER.CANNOT_LOGIN]:              { icon: <WarningIcon {...P} />,        color: 'error',   category: 'security', titleKey: 'humanCannotLogin' },
  [I.SESSION.SESSION_EXPIRED]:        { icon: <ShieldWarningIcon {...P} />,  color: 'warning', category: 'security', titleKey: 'humanSessionExpired' },
  [I.SESSION.SESSION_DELETED]:        { icon: <TrashIcon {...P} />,          color: 'info',    category: 'security', titleKey: 'humanSessionDeleted' },
  [I.SESSION.SESSION_DELETED_EXACTLY]:{ icon: <TrashIcon {...P} />,          color: 'info',    category: 'security', titleKey: 'humanSessionDeleted' },
  [I.SESSION.ALL_SESSIONS_DELETED]:   { icon: <TrashIcon {...P} />,          color: 'warning', category: 'security', titleKey: 'humanAllSessionsDeleted' },
  // Account / user
  [I.USER.USER_CREATED]:              { icon: <UserPlusIcon {...P} />,       color: 'success', category: 'account',  titleKey: 'humanUserCreated' },
  [I.USER.USER_REGISTERED]:           { icon: <UserPlusIcon {...P} />,       color: 'success', category: 'account',  titleKey: 'humanUserRegistered' },
  [I.ACCOUNT.ACCOUNT_CREATED]:        { icon: <UserPlusIcon {...P} />,       color: 'success', category: 'account',  titleKey: 'humanAccountCreated' },
  [I.USER.ACCOUNT_SOFT_DELETED]:      { icon: <TrashIcon {...P} />,          color: 'error',   category: 'account',  titleKey: 'humanUserDeletedSelf' },
  [I.USER.USER_NAME_CHANGED]:         { icon: <PencilSimpleIcon {...P} />,   color: 'primary', category: 'account',  titleKey: 'humanUserNameChanged' },
  [I.USER.USER_EMAIL_CHANGE_REQUESTED]:{ icon: <PencilSimpleIcon {...P} />,  color: 'warning', category: 'security', titleKey: 'humanEmailChangeRequested' },
  [I.USER.USER_EMAIL_CHANGE_CONFIRMED]:{ icon: <PencilSimpleIcon {...P} />,  color: 'primary', category: 'account',  titleKey: 'humanUserEmailChanged' },
  [I.ACCOUNT.DISPLAY_NAME_CHANGED]:   { icon: <PencilSimpleIcon {...P} />,   color: 'primary', category: 'account',  titleKey: 'humanDisplayNameChanged' },
  [I.ACCOUNT.PRICING_PLAN_CHANGED]:   { icon: <TrendUpIcon {...P} />,        color: 'primary', category: 'account',  titleKey: 'humanPricingPlanChanged' },
  [I.ACCOUNT.PAYMENT_DONE]:           { icon: <CreditCardIcon {...P} />,     color: 'success', category: 'account',  titleKey: 'humanPaymentDone' },
  [I.ACCOUNT.ACCOUNT_LOCATION_SET]:   { icon: <MapPinIcon {...P} />,         color: 'primary', category: 'account',  titleKey: 'humanLocationSet' },
  [I.ACCOUNT.VANITY_URL_SET]:         { icon: <LinkIcon {...P} />,           color: 'primary', category: 'account',  titleKey: 'humanVanityUrlSet' },
  [I.USER.USER_DATA_EXPORTED]:        { icon: <DownloadIcon {...P} />,       color: 'info',    category: 'account',  titleKey: 'humanDataExported' },
  // Gallery
  [I.GALLERY.GALLERY_RECORD_CREATED]: { icon: <ImageIcon {...P} />,          color: 'primary', category: 'gallery',  titleKey: 'humanGalleryCreated' },
  [I.GALLERY.GALLERY_RECORD_UPDATED]: { icon: <PencilSimpleIcon {...P} />,   color: 'primary', category: 'gallery',  titleKey: 'humanGalleryUpdated' },
  [I.GALLERY.GALLERY_RECORD_DELETED]: { icon: <TrashIcon {...P} />,          color: 'info',    category: 'gallery',  titleKey: 'humanGalleryDeleted' },
  [I.GALLERY.GALLERY_RECORD_PINNED]:  { icon: <PushPinIcon {...P} />,        color: 'primary', category: 'gallery',  titleKey: 'humanGalleryPinned' },
  [I.GALLERY.GALLERY_RECORD_UNPINNED]:{ icon: <PushPinSlashIcon {...P} />,   color: 'muted',   category: 'gallery',  titleKey: 'humanGalleryUnpinned' },
  [I.GALLERY.ASSET_UPLOADED]:         { icon: <CameraIcon {...P} />,         color: 'success', category: 'gallery',  titleKey: 'humanAssetUploaded' },
  // PAIRING_* (bucket DOMAIN) i EMAIL_* (bucket EMAIL) usunięte 2026-07-11:
  // UI fetchuje wyłącznie LOGIN + ACCOUNT, te wiersze nigdy nie przychodziły.
};
