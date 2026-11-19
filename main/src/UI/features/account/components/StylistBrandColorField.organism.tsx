// UI/features/account/components/StylistBrandColorField.organism.tsx
// The brand colour of the stylist's own profile: the shared picker plus its own save outcome.
// Its box ('Kolor marki') has no save line of its own, so the colour says whether it was saved
// (a clean-context reader saw „no Zapisz and no zapisano”). Saving itself stays with the section.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BrandColorFieldMolecule } from '../../shared/branding/BrandColorField.molecule';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import { usePurchaseResumeCapture } from '../../shared/upsell/usePurchaseResumeCapture';
import { useNavigationStore } from '../../../../application/stores/navigation.store';

export function StylistBrandColorFieldOrganism({
  value,
  savedValue,
  canBrand,
  isPending,
  hasFailed,
  onSelect,
}: {
  value: string;
  savedValue: string;
  canBrand: boolean;
  isPending: boolean;
  hasFailed: boolean;
  onSelect: (hex: string) => void;
}) {
  const t = useTranslations('account.profile');
  const captureResume = usePurchaseResumeCapture();
  const tOutcome = useTranslations('components.outcomeFeedback');
  // Only a choice made on this visit earns „saved”; an untouched picker is quiet.
  const [touched, setTouched] = useState(false);
  const navigationPhase = useNavigationStore(state => state.phase);
  const anchorHandled = useRef(false);
  const saved = touched && value === savedValue;
  useEffect(() => {
    if (anchorHandled.current || window.location.hash !== '#brand-colour') {
      return;
    }
    // Route reset precedes the entering phase. User input wins if they move on before it settles.
    const events = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;
    const stopListening = () => {
      events.forEach(event => window.removeEventListener(event, cancel, true));
    };
    const cancel = () => {
      anchorHandled.current = true;
      stopListening();
    };
    events.forEach(event =>
      window.addEventListener(event, cancel, { capture: true, passive: true })
    );
    const frame =
      navigationPhase === 'idle'
        ? requestAnimationFrame(() => {
            if (
              anchorHandled.current ||
              window.location.hash !== '#brand-colour' ||
              useNavigationStore.getState().phase !== 'idle'
            ) {
              return;
            }
            const target = document.getElementById('brand-colour');
            if (!target) {
              return;
            }
            anchorHandled.current = true;
            stopListening();
            if (!target.hasAttribute('tabindex')) {
              target.setAttribute('tabindex', '-1');
              target.addEventListener(
                'blur',
                () => target.removeAttribute('tabindex'),
                { once: true }
              );
            }
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: 'start', behavior: 'instant' });
          })
        : null;
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      stopListening();
    };
  }, [navigationPhase]);
  return (
    <BrandColorFieldMolecule
      id='brand-colour'
      label={t('brandingChoice')}
      hint={t('brandingHint')}
      value={value}
      canBrand={canBrand}
      onUpgrade={() => captureResume({ kind: 'brand' })}
      onSelect={hex => {
        setTouched(true);
        onSelect(hex);
      }}
      status={
        <CompletionLineMolecule
          state={
            hasFailed
              ? 'error'
              : isPending
                ? 'pending'
                : saved
                  ? 'complete'
                  : 'idle'
          }
          message={
            hasFailed
              ? tOutcome('saveFailed')
              : isPending
                ? tOutcome('savePending')
                : saved
                  ? tOutcome('saveDone')
                  : ''
          }
          reserveMessage={tOutcome('saveFailed')}
        />
      }
    />
  );
}
