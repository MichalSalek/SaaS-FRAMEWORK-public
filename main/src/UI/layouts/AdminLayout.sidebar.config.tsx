// UI/layouts/AdminLayout.sidebar.config.tsx
// Sidebar navigation taxonomy for AdminLayout (rows drawn by
// AdminLayout.sidebarNav.organism.tsx through the shared NavRow primitive).
//
// DECISION (nie usuwaj tego komentarza) — głos ownera `s126-admin`,
// 2026-10-09: wygrał układ DZIŚ, czyli PEŁNE menu. Wszystkie 19 celów admina
// stoi w menu w swoich czterech grupach; trzy kandydaty z pięcioma modułami
// (cele schowane pod ekranami grupującymi i zakładkami) przegrały i zostały
// usunięte. Słowa ownera: „wydaje mi się, że najbezpieczniej jest wystawić
// wszystko w menu dla admina, żeby wszystko łatwo odszukać. Poza tym każda
// pozycja w menu może alarmować chipem (1) w razie czego. W innych
// przypadkach funkcje są zbyt pochowane i można się zgubić.”
// Wniosek na przyszłość: NIE łącz celów admina i NIE chowaj ich za ekranem
// grupującym, zakładkami ani pozycją „Więcej”. Nowa strona admina = nowa
// pozycja tutaj. Każda pozycja, która ma licznik (`attentionKeys`), pokazuje
// go jako badge wiersza i przy liczbie większej od zera prowadzi wprost do
// policzonej listy.

import type { ReactNode } from 'react';
import {
  SquaresFourIcon,
  UsersIcon,
  ScrollIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  NoteIcon,
  ScalesIcon,
  MegaphoneIcon,
  LockIcon,
  PaletteIcon,
  FlagIcon,
  HeartbeatIcon,
  ChartBarIcon,
  GearIcon,
  EnvelopeSimpleIcon,
  EnvelopeOpenIcon,
  ChatCircleDotsIcon,
  RobotIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import type { Icon } from '@phosphor-icons/react';
import {
  ADMIN_ATTENTION_ORDER,
  type AdminAttentionKey,
} from '../features/admin/admin-attention.config';

// prettier-ignore
type AdminLayoutKey = 'sectionMonitoring' | 'sectionContent' | 'sectionConfiguration' | 'sectionSystem' | 'itemDashboard' | 'itemUsers' | 'itemLogs' | 'itemAudit' | 'itemAiCrawlers' | 'itemNotes' | 'itemPolicies' | 'itemAnnouncements' | 'itemReports' | 'itemModeration' | 'itemEmailSchedule' | 'itemEmailPreview' | 'itemSupport' | 'itemPermissions' | 'itemColorsTraits' | 'itemFeatureFlags' | 'itemHealth' | 'itemConfig';

interface SidebarItem {
  labelKey: AdminLayoutKey;
  path: string;
  icon: ReactNode;
  iconActive: ReactNode;
  // Liczniki z ADMIN_GET_ATTENTION_COUNTS, które należą do tej pozycji: badge
  // pokazuje ich sumę, a gdy coś czeka, pozycja prowadzi WPROST do listy
  // policzonych elementów (features/admin/admin-attention.config.ts mówi, co
  // każdy licznik liczy i gdzie jest jego lista). Nowe źródło = pole w
  // AdminAttentionCountsResponse (kernel) + wpis w tamtym configu + klucz tutaj.
  attentionKeys?: readonly AdminAttentionKey[];
  // Strona pozycji sama pokazuje wszystkie swoje kolejki (panel „Wymaga
  // reakcji” na dashboardzie): cel się nie zmienia, liczba to suma.
  attentionOwnPage?: boolean;
}

export interface SidebarSection {
  labelKey: AdminLayoutKey;
  items: SidebarItem[];
}

const USERS_ATTENTION_KEYS: readonly AdminAttentionKey[] = [
  'payments_attention',
  'stuck_accounts',
];

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    labelKey: 'sectionMonitoring',
    items: [
      {
        labelKey: 'itemDashboard',
        path: ROUTES_FRONT_APP.ADMIN,
        icon: <SquaresFourIcon size={18} weight='regular' />,
        iconActive: <SquaresFourIcon size={18} weight='fill' />,
        attentionKeys: ADMIN_ATTENTION_ORDER,
        attentionOwnPage: true,
      },
      {
        labelKey: 'itemUsers',
        path: ROUTES_FRONT_APP.ADMIN_USERS,
        icon: <UsersIcon size={18} weight='regular' />,
        iconActive: <UsersIcon size={18} weight='fill' />,
        attentionKeys: USERS_ATTENTION_KEYS,
      },
      {
        labelKey: 'itemLogs',
        path: ROUTES_FRONT_APP.ADMIN_LOGS,
        icon: <ScrollIcon size={18} weight='regular' />,
        iconActive: <ScrollIcon size={18} weight='fill' />,
        attentionKeys: ['log_issues_open'],
      },
      {
        labelKey: 'itemAudit',
        path: ROUTES_FRONT_APP.ADMIN_AUDIT,
        icon: <ShieldCheckIcon size={18} weight='regular' />,
        iconActive: <ShieldCheckIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemAiCrawlers',
        path: ROUTES_FRONT_APP.ADMIN_AI_CRAWLERS,
        icon: <RobotIcon size={18} weight='regular' />,
        iconActive: <RobotIcon size={18} weight='fill' />,
      },
    ],
  },
  {
    labelKey: 'sectionContent',
    items: [
      {
        labelKey: 'itemNotes',
        path: ROUTES_FRONT_APP.ADMIN_NOTES,
        icon: <NoteIcon size={18} weight='regular' />,
        iconActive: <NoteIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemPolicies',
        path: ROUTES_FRONT_APP.ADMIN_POLICIES,
        icon: <ScalesIcon size={18} weight='regular' />,
        iconActive: <ScalesIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemAnnouncements',
        path: ROUTES_FRONT_APP.ADMIN_ANNOUNCEMENTS,
        icon: <MegaphoneIcon size={18} weight='regular' />,
        iconActive: <MegaphoneIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemReports',
        path: ROUTES_FRONT_APP.ADMIN_REPORTS,
        icon: <ChartBarIcon size={18} weight='regular' />,
        iconActive: <ChartBarIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemModeration',
        path: ROUTES_FRONT_APP.ADMIN_MODERATION,
        icon: <ShieldWarningIcon size={18} weight='regular' />,
        iconActive: <ShieldWarningIcon size={18} weight='fill' />,
        attentionKeys: ['moderation_pending'],
      },
      {
        labelKey: 'itemEmailSchedule',
        path: ROUTES_FRONT_APP.ADMIN_EMAIL_SCHEDULE,
        icon: <EnvelopeSimpleIcon size={18} weight='regular' />,
        iconActive: <EnvelopeSimpleIcon size={18} weight='fill' />,
        attentionKeys: ['email_sweep_issues'],
      },
      {
        labelKey: 'itemEmailPreview',
        path: ROUTES_FRONT_APP.ADMIN_EMAIL_PREVIEW,
        icon: <EnvelopeOpenIcon size={18} weight='regular' />,
        iconActive: <EnvelopeOpenIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemSupport',
        path: ROUTES_FRONT_APP.ADMIN_SUPPORT,
        icon: <ChatCircleDotsIcon size={18} weight='regular' />,
        iconActive: <ChatCircleDotsIcon size={18} weight='fill' />,
        attentionKeys: ['support_awaiting_reply'],
      },
    ],
  },
  {
    labelKey: 'sectionConfiguration',
    items: [
      {
        labelKey: 'itemPermissions',
        path: ROUTES_FRONT_APP.ADMIN_PERMISSIONS,
        icon: <LockIcon size={18} weight='regular' />,
        iconActive: <LockIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemColorsTraits',
        path: ROUTES_FRONT_APP.ADMIN_COLORS_TRAITS,
        icon: <PaletteIcon size={18} weight='regular' />,
        iconActive: <PaletteIcon size={18} weight='fill' />,
      },
      {
        labelKey: 'itemFeatureFlags',
        path: ROUTES_FRONT_APP.ADMIN_FEATURE_FLAGS,
        icon: <FlagIcon size={18} weight='regular' />,
        iconActive: <FlagIcon size={18} weight='fill' />,
      },
    ],
  },
  {
    labelKey: 'sectionSystem',
    items: [
      {
        labelKey: 'itemHealth',
        path: ROUTES_FRONT_APP.ADMIN_HEALTH,
        icon: <HeartbeatIcon size={18} weight='regular' />,
        iconActive: <HeartbeatIcon size={18} weight='fill' />,
        attentionKeys: ['system_health_issues'],
      },
      {
        labelKey: 'itemConfig',
        path: ROUTES_FRONT_APP.ADMIN_CONFIG,
        icon: <GearIcon size={18} weight='regular' />,
        iconActive: <GearIcon size={18} weight='fill' />,
      },
    ],
  },
];

/* ─── Bottom nav tabs (mobile — 5 most critical) ─── */

// prettier-ignore
type AdminTabKey = 'tabDashboard' | 'tabUsers' | 'tabLogs' | 'tabConfig' | 'tabHealth';

export interface AdminBottomTab {
  labelKey: AdminTabKey;
  icon: Icon;
  path: string;
  attentionKeys?: readonly AdminAttentionKey[];
  attentionOwnPage?: boolean;
}

// The phone has no room for Wsparcie / Moderacja, so „Panel” carries the total
// of every queue and its page lists them („Wymaga reakcji”): nothing that
// waits is invisible from the tab bar.
export const ADMIN_BOTTOM_TABS: readonly AdminBottomTab[] = [
  {
    labelKey: 'tabDashboard',
    icon: SquaresFourIcon,
    path: ROUTES_FRONT_APP.ADMIN,
    attentionKeys: ADMIN_ATTENTION_ORDER,
    attentionOwnPage: true,
  },
  {
    labelKey: 'tabUsers',
    icon: UsersIcon,
    path: ROUTES_FRONT_APP.ADMIN_USERS,
    attentionKeys: USERS_ATTENTION_KEYS,
  },
  {
    labelKey: 'tabLogs',
    icon: ScrollIcon,
    path: ROUTES_FRONT_APP.ADMIN_LOGS,
    attentionKeys: ['log_issues_open'],
  },
  {
    labelKey: 'tabConfig',
    icon: GearIcon,
    path: ROUTES_FRONT_APP.ADMIN_CONFIG,
  },
  {
    labelKey: 'tabHealth',
    icon: HeartbeatIcon,
    path: ROUTES_FRONT_APP.ADMIN_HEALTH,
    attentionKeys: ['system_health_issues'],
  },
];
