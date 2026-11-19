import type { ReactNode } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { BrandDecisionFrameOrganism } from '../../../components/BrandDecisionFrame/BrandDecisionFrame.organism';
import { BrandMarkAtom } from '../../../components/BrandMark/BrandMark.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { AppModalShellAtom } from '../../../primitives/AppModalShell.atom';
import type { FocusTrapInitialFocus } from '../../../hooks/useFocusTrap';
import { usePlanDecisionNavigation } from '../../../shared/hooks/usePlanDecisionNavigation';
import styles from './PlanDecisionSurface.module.css';

export interface PlanDecisionSurfaceProps {
  title: string;
  titleId: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  onClose: () => void;
  dismissLocked?: boolean;
  benefits?: readonly string[];
  describedById?: string;
  role?: 'dialog' | 'alertdialog';
  initialFocus?: FocusTrapInitialFocus;
  backLabel?: string;
}

/** Presentation only: the caller retains its quote, form and financial actions. */
export function PlanDecisionSurfaceOrganism({
  title,
  titleId,
  children,
  onClose,
  dismissLocked = false,
  benefits = [],
  describedById,
  role = 'dialog',
  initialFocus = 'container',
  backLabel,
}: PlanDecisionSurfaceProps) {
  const t = useTranslations('account.pay.decision');
  const close = usePlanDecisionNavigation({ onClose, dismissLocked });
  return (
    <AppModalShellAtom
      variant='fullscreen'
      portal
      inert='app-root'
      scrollLock
      role={role}
      labelledById={titleId}
      {...(describedById ? { describedById } : {})}
      initialFocus={initialFocus}
      onClose={close}
      className={styles.surface}>
      <BrandDecisionFrameOrganism
        intro={
          <div className={styles.intro}>
            <ButtonAtom
              variant='text'
              icon={<ArrowLeftIcon size={20} />}
              disabled={dismissLocked}
              onClick={close}
              className={styles.back}>
              {backLabel ?? t('back')}
            </ButtonAtom>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {benefits.length > 0 && (
              <ul className={styles.benefits}>
                {benefits.map(benefit => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
            )}
          </div>
        }>
        <BrandMarkAtom className={styles.mark} sizes='64px' label='Nailfolio' />
        <div className={styles.body}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      </BrandDecisionFrameOrganism>
    </AppModalShellAtom>
  );
}
