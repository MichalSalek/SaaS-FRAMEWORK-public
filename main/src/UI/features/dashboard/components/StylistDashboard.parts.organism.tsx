// UI/features/dashboard/components/StylistDashboard.parts.tsx
// Extracted sub-components for StylistDashboard: ActivationCard
// (PairedClientsWidget lives in PairedClientsWidget.organism.tsx).

import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  CircleIcon,
  ClockAfternoonIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { TIME } from '@kernel/application/constants.config';
import type { ActivationProgress } from '../hooks/useActivationProgress';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { DisclosureMolecule } from '../../../components/Disclosure/Disclosure.molecule';
import styles from './StylistDashboard.module.css';
import pageStyles from '../DashboardPage.module.css';

/* --- ActivationCard (DASH-1/6: unified living activation stepper) --- */

interface ActivationCardProps {
  /** Endowed + live milestone state from useActivationProgress. */
  progress: ActivationProgress;
  /** F2-F6: Date or null. When ≤7 days remain, show trial urgency nudge. */
  /** Z API przychodzi ISO string mimo typu kernela (DateAndTime = Date). */
  trialEndsAt: Date | string | null;
}

interface ActivationStep {
  key: string;
  label: string;
  done: boolean;
  /** Where tapping the step navigates, or null for a passive milestone. */
  route: string | null;
  /** Who completes a passive step (shown while it is not done). */
  hint?: string;
}

/**
 * The single living activation checklist, folded to one line with its
 * progress (S126: it guides, the stage action above it leads). Endowed with an
 * always-complete "account" row so the journey never reads as empty, and
 * per-milestone rows that check off as the stylist adds a
 * photo, fills in her public page, pairs a client and receives an inspiration
 * session. It stays until 4/4 (high-water latched) — never disappearing after
 * just the first photo.
 *
 * DECISION (nie usuwaj tego komentarza): trial urgency is surfaced here (not a
 * second TrialCountdownBanner — that lives in AppLayout header). We only read
 * trial_ends_at; combining activation + loss-aversion at the same moment is the
 * highest-leverage nudge for an at-risk new stylist.
 */
export function ActivationChecklistOrganism({
  progress,
  trialEndsAt,
}: ActivationCardProps) {
  const t = useTranslations('dashboard.stylist');

  // DECISION (nie usuwaj tego komentarza): `trial_ends_at` z currentUser to w
  // runtime ISO string (JSON), choć kernel typuje go jako Date. Wołanie
  // .getTime() wprost wywracało cały panel stylistki na trialu („Coś poszło nie
  // tak"). Normalizacja jak w TrialCountdownBanner; nieparsowalna data = brak baneru.
  const trialDate = trialEndsAt === null ? null : new Date(trialEndsAt);
  const daysRemaining =
    trialDate !== null && !isNaN(trialDate.getTime())
      ? Math.max(
          0,
          Math.ceil((trialDate.getTime() - Date.now()) / TIME.MS_PER_DAY)
        )
      : null;
  const showTrialUrgency =
    daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 7;

  // Endowed step 0 (account) is always done — anchors the journey with a win.
  const steps: ActivationStep[] = [
    { key: 'account', label: t('onboarding.step0'), done: true, route: null },
    {
      key: 'photo',
      label: t('onboarding.step1'),
      done: progress.photo,
      route: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
    },
    {
      // Wizytówka publiczna — krok dołożony 2026-09-09 (zgłoszenie ownera:
      // samouczek nie mówił o publicznym profilu ani o przypinaniu prac).
      key: 'profile',
      label: t('onboarding.step2'),
      done: progress.profile,
      route: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
    },
    {
      key: 'pair',
      label: t('onboarding.step3'),
      done: progress.pair,
      route: ROUTES_FRONT.PAIRING,
    },
    {
      // Passive milestone — a paired client shares the session; the stylist
      // cannot self-complete it, so the row is informational (no route).
      key: 'session',
      label: t('onboarding.step4'),
      done: progress.session,
      route: null,
      hint: t('onboarding.step4Hint'),
    },
  ];

  // The counter counts the rows she SEES, endowed account row included
  // (S126: „0 / 4” above five rows, one of them ticked, contradicted itself).
  const doneRows = steps.filter(step => step.done).length;

  return (
    <DisclosureMolecule
      title={t('onboarding.title')}
      summary={t('onboarding.progress', {
        done: doneRows,
        total: steps.length,
      })}>
      {showTrialUrgency && (
        <p className={styles.trialLine}>
          <span className={styles.trialIcon} aria-hidden='true'>
            <ClockAfternoonIcon size={16} weight='fill' />
          </span>
          <span>{t('onboarding.trialUrgency', { days: daysRemaining })}</span>
        </p>
      )}
      {/* DECISION (nie usuwaj tego komentarza) — S126: a step she can do is a
          navigation row with a quiet chevron; a done step and the passive one
          are plain lines. Three raspberry discs here competed with the one
          filled action of the screen, and the passive step, the only row
          without an arrow, read as broken. Its hint now says who completes it. */}
      <div className={styles.checklist}>
        <NavRowListMolecule ariaLabel={t('onboarding.title')}>
          {steps.map(step =>
            !step.done && step.route !== null ? (
              <NavRowMolecule
                key={step.key}
                href={step.route}
                icon={<CircleIcon />}
                label={step.label}
                trailing='chevron'
              />
            ) : (
              <li key={step.key} className={pageStyles.staticRow}>
                <span className={pageStyles.staticRowIcon} aria-hidden='true'>
                  {step.done ? (
                    <CheckCircleIcon size={22} weight='fill' />
                  ) : (
                    <CircleIcon size={22} />
                  )}
                </span>
                <span className={pageStyles.staticRowBody}>
                  <span>{step.label}</span>
                  {!step.done && step.hint !== undefined && (
                    <span className={pageStyles.staticRowHint}>
                      {step.hint}
                    </span>
                  )}
                </span>
              </li>
            )
          )}
        </NavRowListMolecule>
      </div>
    </DisclosureMolecule>
  );
}
