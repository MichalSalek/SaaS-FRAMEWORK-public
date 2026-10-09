// UI/features/support/SupportThreadDetailPage.tsx
// Support thread detail — direct line to the beauty product team.
//
// Vibe: "humans answering humans". NIE corporate ticket UI z numerami sprawy,
// NIE generic chat box. Warm team-identity (Nailfolio Team avatar + role),
// editorial hero with status pill and a compose dock that
// feels like Slack's message input — not an email reply form.
//
// Visual language (Anti-AI-Slop flat): solid tonal surfaces + full hairlines,
// ZERO gradient washes / box-shadow elevation / glow:
//  - Hero slab with eyebrow chip (gold dot + tracked uppercase)
//  - Solid accent slab + sparkle SVG mask (functional motif)
//  - Spring easing (cubic-bezier(0.34, 1.56, 0.64, 1)) on interactions
//  - Stagger entrance via animation-timeline: view() progressive enhancement
//  - Dark mode parity via :root[data-mode='dark']
//
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  InfoIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChatCircleDotsIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type {
  SupportThreadCategory,
  SupportThreadStatus,
} from '@kernel/models/support/support.dto';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useReportHeroVisibility } from '../../components/AppHero/useReportHeroVisibility';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { StatusPillAtom as UiStatusPill } from '../../components/StatusPill/StatusPill.atom';
import { getSupportStatusColor } from './supportStatus.helpers';
import { useSupportThreadMessages } from './hooks/useSupportThreadMessages';
import { useMarkSupportThreadRead } from './hooks/useMarkSupportThreadRead';
import { BurstOrganism, groupIntoBursts } from './SupportThreadBurst.organism';
import { SupportComposeBarOrganism } from './SupportComposeBar.organism';
import type { TSupport } from './supportDate.helpers';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import styles from './SupportThreadDetailPage.module.css';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function getStatusLabel(status: SupportThreadStatus, t: TSupport): string {
  switch (status) {
    case 'OPEN':
      return t('statusOpen');
    case 'RESOLVED':
      return t('statusResolved');
    case 'CLOSED':
      return t('statusClosed');
  }
}

/* ------------------------------------------------------------------ */
/*  Status pill (color-coded with dot or icon)                          */
/* ------------------------------------------------------------------ */

function StatusPill({
  status,
  t,
}: {
  status: SupportThreadStatus;
  t: TSupport;
}) {
  const icon =
    status === 'RESOLVED' ? (
      <CheckCircleIcon size={12} weight='fill' aria-hidden='true' />
    ) : status === 'CLOSED' ? (
      <XCircleIcon size={12} weight='fill' aria-hidden='true' />
    ) : undefined;

  return (
    <UiStatusPill
      color={getSupportStatusColor(status)}
      label={getStatusLabel(status, t)}
      uppercase
      pulse={status === 'OPEN'}
      {...(icon ? { icon } : {})}
    />
  );
}

/* (BackLink/chip "← Skrzynka" usunięty S26: dublował nawigację wstecz
 * z navbara "< Wróć" — census wskazał podwójną nawigację.) */

/* ------------------------------------------------------------------ */
/*  Messages skeleton                                                    */
/* ------------------------------------------------------------------ */

function MessagesSkeleton() {
  // Mirror docelowego layoutu (census S26): strona usera bez avatara
  // i identity — tylko meta czasowa; avatar + nazwa zespołu po stronie
  // supportu (jedna etykieta, bez linii roli).
  return (
    <div className={styles.messagesList}>
      {Array.from({ length: 3 }).map((_, i) => {
        const isUser = i % 2 === 1;
        return (
          <div
            key={i}
            className={`${styles.burst} ${isUser ? styles.burstUser : styles.burstSupport}`}>
            <div className={styles.burstHeader}>
              {isUser ? (
                <SkeletonAtom variant='text' width={60} height={10} />
              ) : (
                <>
                  <SkeletonAtom variant='circle' width={32} height={32} />
                  <div className={styles.skeletonIdentity}>
                    <SkeletonAtom variant='text' width={90} height={11} />
                  </div>
                </>
              )}
            </div>
            <div className={styles.burstStack}>
              <SkeletonAtom
                variant='rect'
                width={isUser ? '60%' : '72%'}
                height={56}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero header                                                          */
/* ------------------------------------------------------------------ */

function HeroHeader({
  status,
  category = null,
  subject,
  subtitle,
  t,
}: {
  status: SupportThreadStatus | null;
  /** null = not loaded yet, or a thread from before categories existed. */
  category?: SupportThreadCategory | null;
  subject: string | null;
  subtitle: string | null;
  t: TSupport;
}) {
  // Lokalny hero (markup celowo inny niż AppHero) podpięty pod SSOT mechanizmu
  // large-title: raportuje widoczność do AppLayout, by top-bar nie dublował
  // tytułu, dopóki karta-intro jest w kadrze (wzorzec OnboardingHero).
  const heroRef = useRef<HTMLElement | null>(null);
  useReportHeroVisibility(heroRef);
  return (
    <header ref={heroRef} className={styles.hero}>
      {status !== null && (
        <div className={styles.heroBackRow}>
          {category !== null && (
            <span className={styles.heroCategory}>
              {t(`categories.${category}`)}
            </span>
          )}
          <StatusPill status={status} t={t} />
        </div>
      )}
      {subject !== null ? (
        <h1 className={styles.heroTitle}>{subject}</h1>
      ) : (
        <SkeletonAtom variant='text' width='70%' height={32} />
      )}
      {subtitle !== null ? (
        <p className={styles.heroSubtitle}>{subtitle}</p>
      ) : (
        <SkeletonAtom variant='text' width='45%' height={16} />
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty / closed banner / error                                       */
/* ------------------------------------------------------------------ */

function ClosedBanner({ t }: { t: TSupport }) {
  return (
    <div className={styles.closedBanner} role='status'>
      <div className={styles.closedBannerIcon}>
        <InfoIcon size={18} weight='fill' />
      </div>
      <div className={styles.closedBannerCopy}>
        <TypographyAtom variant='body2' className={styles.closedBannerTitle}>
          {t('threadClosedTitle')}
        </TypographyAtom>
        <TypographyAtom variant='caption' className={styles.closedBannerHint}>
          {t('threadClosed')}
        </TypographyAtom>
      </div>
    </div>
  );
}

function EmptyConversation({ t }: { t: TSupport }) {
  return (
    <EmptyStateAtom
      className={styles.emptyConversation}
      icon={<ChatCircleDotsIcon size={28} weight='duotone' />}
      title={t('emptyConversationTitle')}
      titleAs='p'
      description={t('emptyConversationHint')}
    />
  );
}

function ErrorPanel({
  onBack,
  onRetry,
  retrying,
  t,
}: {
  onBack: () => void;
  onRetry: () => void;
  /** TQ v5 keeps `status: 'error'` while a retry is in flight. */
  retrying: boolean;
  t: TSupport;
}) {
  return (
    <div className={styles.errorState} role='alert'>
      <div className={styles.errorIcon}>
        <InfoIcon size={28} />
      </div>
      <TypographyAtom variant='h4' className={styles.errorTitle}>
        {t('errorLoadThread')}
      </TypographyAtom>
      <TypographyAtom variant='body2' className={styles.errorHint}>
        {t('errorLoadThreadHint')}
      </TypographyAtom>
      {/* Retry first: most failures are a flaky connection, and „back to the
          list, then open it again” was the only way out. */}
      <ButtonAtom
        variant='outlined'
        size='md'
        disabled={retrying}
        aria-busy={retrying}
        onClick={onRetry}>
        {t('retry')}
      </ButtonAtom>
      <ButtonAtom variant='ghost' size='md' onClick={onBack}>
        {t('backToInbox')}
      </ButtonAtom>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inner Page                                                         */
/* ------------------------------------------------------------------ */

// Route-param reader. The data-dependent body lives in
// SupportThreadDetailContent and is mounted ONLY once `threadId` resolves to a
// real string — this is what lets useSupportThreadMessages take a guaranteed
// non-empty `threadId` (no '' cache entry) without violating Rules of Hooks
// (no hook is called conditionally; we gate at the component boundary).
function SupportThreadDetailPageInner() {
  const router = useRouter();
  const threadId =
    typeof router.query.threadId === 'string'
      ? router.query.threadId
      : undefined;

  if (threadId === undefined) {
    return null;
  }

  return <SupportThreadDetailContent threadId={threadId} />;
}

function SupportThreadDetailContent({ threadId }: { threadId: string }) {
  const t = useTranslations('pages.support');
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isFetching, refetch } =
    useSupportThreadMessages(threadId);

  const messages = data?.messages ?? [];
  const thread = data?.thread;
  const isClosed = thread?.status === 'CLOSED';
  const bursts = groupIntoBursts(messages);

  // Opening the thread reads it: the marker goes to the server once the
  // messages are on screen, ONCE per opened thread. `data` changes on every
  // refetch (refocus, a sent reply), so the ref, not the data, decides.
  const { mutate: markThreadRead } = useMarkSupportThreadRead();
  const markedThreadIdRef = useRef<string | null>(null);
  const hasLoaded = data !== undefined;
  useEffect(() => {
    if (!hasLoaded || markedThreadIdRef.current === threadId) {
      return;
    }
    markedThreadIdRef.current = threadId;
    markThreadRead(threadId);
  }, [hasLoaded, threadId, markThreadRead]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current !== null) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const handleBack = () => {
    void router.push(ROUTES_FRONT.SUPPORT_THREADS);
  };

  if (isLoading) {
    return (
      <div className={styles.page}>
        <HeroHeader status={null} subject={null} subtitle={null} t={t} />
        <MessagesSkeleton />
      </div>
    );
  }

  // Error panel only when there is no thread to show. A failed background
  // refetch (refocus, invalidation after a reply) keeps the cached thread in
  // TQ v5; swapping it for an error hid the conversation the user was reading.
  if (thread === undefined) {
    return (
      <div className={styles.page}>
        <HeroHeader status={null} subject={null} subtitle={null} t={t} />
        <ErrorPanel
          onBack={handleBack}
          onRetry={() => void refetch()}
          retrying={isFetching}
          t={t}
        />
      </div>
    );
  }

  const subtitle = isClosed
    ? t('heroSubtitleClosed')
    : t('heroSubtitleActive', { count: messages.length });

  return (
    <div className={styles.page}>
      <HeroHeader
        status={thread.status}
        category={thread.category}
        subject={thread.subject}
        subtitle={subtitle}
        t={t}
      />

      {isClosed && <ClosedBanner t={t} />}

      {bursts.length === 0 ? (
        <EmptyConversation t={t} />
      ) : (
        <div className={styles.messagesList} aria-live='polite'>
          {bursts.map((burst, idx) => (
            <BurstOrganism
              key={`burst-${idx}-${burst.messages[0]?.id ?? idx}`}
              burst={burst}
              t={t}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {!isClosed && <SupportComposeBarOrganism threadId={threadId} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shell with AppLayout                                               */
/* ------------------------------------------------------------------ */

export function SupportThreadDetailPageComposition() {
  const t = useTranslations('pages.support');
  return (
    <AppLayoutComposition title={t('title')}>
      <SupportThreadDetailPageInner />
    </AppLayoutComposition>
  );
}
