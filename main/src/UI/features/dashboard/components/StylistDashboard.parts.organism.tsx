// UI/features/dashboard/components/StylistDashboard.parts.tsx
// Extracted sub-components for StylistDashboard: ActivationCard
// (PairedClientsWidget lives in PairedClientsWidget.organism.tsx).

import { useTranslations } from 'next-intl';
import { CheckCircleIcon, CircleIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
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
 * The single living activation checklist, folded to one line with its progress (it guides, the
 * stage action above it leads). Endowed with an always-complete "account" row so the journey never
 * reads as empty, and per-milestone rows that check off as the stylist adds a photo, fills in her
 * public page, pairs a client and receives an inspiration session. It stays until 4/4 (high-water
 * latched) — never disappearing after just the first photo.

 */
export function ActivationChecklistOrganism({ progress }: ActivationCardProps) {
  const t = useTranslations('dashboard.stylist');

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
      // Public card — a step added because the onboarding tutorial said nothing about the public
      // profile or about pinning works.
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

  // The counter counts the rows she SEES, endowed account row included („0 / 4” above five rows,
  // one of them ticked, contradicted itself).
  const doneRows = steps.filter(step => step.done).length;

  return (
    <DisclosureMolecule
      title={t('onboarding.title')}
      summary={t('onboarding.progress', {
        done: doneRows,
        total: steps.length,
      })}>
      {/* DECISION: a step she can do is a navigation row with a quiet chevron; a done step and
          the passive one are plain lines. Three raspberry discs here competed with the one
          filled action of the screen, and the passive step, the only row without an arrow, read
          as broken. Its hint now says who completes it. */}
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
