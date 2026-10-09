// UI/features/admin/AdminSupportThreadPage.parts.organism.tsx
// The conversation of one support thread: day separators, bursts (consecutive
// messages of one sender under one header) and the loading shape. The person
// panel, the status and the notes live in AdminSupportThreadPage.aside; the
// reply box in AdminSupportThreadPage.compose.

import type { useTranslations } from 'next-intl';
import type { SupportMessageDTO } from '@kernel/models/support/support.dto';
import { SUPPORT_LENGTHS } from '@kernel/policies/validation.config';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './AdminSupportThreadPage.module.css';
import type { ThreadIdentity } from './supportIdentity.helpers';

// SSOT lives in shared-kernel/policies/validation.config.ts (SUPPORT_LENGTHS).
// Server caps replies and internal notes at 2000 chars — keep client cap aligned.
export const REPLY_MAX = SUPPORT_LENGTHS.REPLY_MAX;
export const NOTE_MAX = SUPPORT_LENGTHS.INTERNAL_NOTE_MAX;

/* ─── Helpers ─── */

function formatTime(value: string | Date, locale: string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatDateLine(value: string | Date, locale: string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* ─── Burst grouping (consecutive same-sender) ─── */

type MessageBurst = {
  sender_type: SupportMessageDTO['sender_type'];
  messages: SupportMessageDTO[];
};

function groupIntoBursts(messages: SupportMessageDTO[]): MessageBurst[] {
  const bursts: MessageBurst[] = [];
  for (const msg of messages) {
    const last = bursts[bursts.length - 1];
    if (last !== undefined && last.sender_type === msg.sender_type) {
      last.messages.push(msg);
    } else {
      bursts.push({ sender_type: msg.sender_type, messages: [msg] });
    }
  }
  return bursts;
}

/** Chronological flow: a date separator before the first burst of each day. */
type ThreadTimelineItem =
  { kind: 'date'; date: Date } | { kind: 'burst'; burst: MessageBurst };

function buildThreadTimeline(
  messages: SupportMessageDTO[]
): ThreadTimelineItem[] {
  const out: ThreadTimelineItem[] = [];
  let lastDate: Date | null = null;
  for (const burst of groupIntoBursts(messages)) {
    const first = burst.messages[0];
    if (first === undefined) {
      continue;
    }
    const d =
      typeof first.created_at === 'string'
        ? new Date(first.created_at)
        : first.created_at;
    if (lastDate === null || !sameDay(lastDate, d)) {
      out.push({ kind: 'date', date: d });
      lastDate = d;
    }
    out.push({ kind: 'burst', burst });
  }
  return out;
}

/* ─── Burst (group header + bubbles) ─── */

function BurstMolecule({
  burst,
  userIdentity,
  t,
}: {
  burst: MessageBurst;
  userIdentity: ThreadIdentity;
  t: ReturnType<typeof useTranslations>;
}) {
  const lang = useCurrentLang();
  const isSupport = burst.sender_type === 'SUPPORT';
  const senderLabel = isSupport ? t('senderSupport') : userIdentity.name;
  const firstMsg = burst.messages[0];
  if (firstMsg === undefined) {
    return null;
  }

  return (
    <article className={styles.burst} data-side={isSupport ? 'end' : 'start'}>
      <header className={styles.burstHeader}>
        <AvatarAtom name={senderLabel} size='sm' decorative />
        <div className={styles.burstIdentity}>
          <span className={styles.burstName}>{senderLabel}</span>
          {/* Role and time: two pieces with a gap, each unbreakable. */}
          <span className={styles.burstMeta}>
            <span>{isSupport ? t('roleSupport') : t('roleUser')}</span>
            <time dateTime={String(firstMsg.created_at)}>
              {formatTime(firstMsg.created_at, lang)}
            </time>
          </span>
        </div>
      </header>

      <div className={styles.bubbleStack}>
        {burst.messages.map((msg, idx) => (
          <div key={msg.id} className={styles.bubble}>
            <p className={styles.bubbleText}>{msg.content}</p>
            {idx > 0 && (
              <time
                className={styles.bubbleTime}
                dateTime={String(msg.created_at)}>
                {formatTime(msg.created_at, lang)}
              </time>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

/* ─── The conversation: day separators and bursts in order ─── */

export function ThreadConversationOrganism({
  messages,
  userIdentity,
  t,
}: {
  messages: SupportMessageDTO[];
  userIdentity: ThreadIdentity;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      {buildThreadTimeline(messages).map((item, idx) =>
        item.kind === 'date' ? (
          <DateSeparatorAtom
            key={`sep-${item.date.getTime()}-${idx}`}
            value={item.date}
          />
        ) : (
          <BurstMolecule
            key={item.burst.messages[0]?.id ?? idx}
            burst={item.burst}
            userIdentity={userIdentity}
            t={t}
          />
        )
      )}
    </>
  );
}

/* ─── Date separator ─── */

function DateSeparatorAtom({ value }: { value: string | Date }) {
  const lang = useCurrentLang();
  return <p className={styles.dateSeparator}>{formatDateLine(value, lang)}</p>;
}

/* ─── Skeleton (three bursts, the middle one on the support side) ─── */

export function MessagesSkeletonMolecule() {
  return (
    <div className={styles.bursts} aria-hidden='true'>
      {(['start', 'end', 'start'] as const).map((side, index) => (
        <div key={index} className={styles.burst} data-side={side}>
          <div className={styles.burstHeader}>
            <SkeletonAtom variant='circle' width={32} height={32} />
            <SkeletonAtom variant='text' width={140} height={16} />
          </div>
          <div className={styles.bubbleStack}>
            <SkeletonAtom width='min(420px, 80%)' height={64} />
          </div>
        </div>
      ))}
    </div>
  );
}
