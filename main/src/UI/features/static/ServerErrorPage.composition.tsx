import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { SystemNoticeOrganism } from '../../components/SystemNotice/SystemNotice.organism';
import notice from '../../components/SystemNotice/SystemNotice.module.css';

/**
 * 500 Server Error page.
 *
 * Layout: the shared system intro (title, one sentence, „Spróbuj ponownie”
 * filled + the way home outlined), then two rows: system status and contact.
 * The former reassure card („Twoje dane są bezpieczne”) is part of the one
 * sentence now, so the fact is stated once.
 *
 * Tone: calm acknowledgment, not alarmist.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Status link points to ROUTES_FRONT.STATUS — the dedicated system status page
 * (SSR health probe), now wired into the kernel. From a 500 screen this is the
 * page the user actually wants: "is it just me, or is everything down?".
 */
export function ServerErrorPageComposition() {
  const t = useTranslations('pages.serverError');

  // Brak „ID błędu dla wsparcia": losowy identyfikator generowany po stronie
  // klienta nie trafiał do żadnego logu, więc support nie mógł go z niczym
  // skorelować — kod wyglądał jak request-ID, a był display-lie. Realny ślad
  // błędu żyje w PostHog error tracking + Event Log Store (bez udziału usera).
  const handleRetry = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <PublicLayoutComposition>
      <div className={notice.page}>
        <SystemNoticeOrganism
          titleId='server-error-heading'
          title={t('heading')}
          body={t('body')}
          actions={
            <>
              <ButtonAtom variant='primary' size='lg' onClick={handleRetry}>
                {t('tryAgain')}
              </ButtonAtom>
              <LinkButtonAtom
                href={ROUTES_FRONT.HOME}
                variant='outlined'
                size='lg'>
                {t('backToHome')}
              </LinkButtonAtom>
            </>
          }
        />

        <div className={notice.links}>
          <NavRowListMolecule ariaLabel={t('moreLinks')}>
            <NavRowMolecule
              href={ROUTES_FRONT.STATUS}
              label={t('statusLink')}
              trailing='chevron'
            />
            <NavRowMolecule
              href={ROUTES_FRONT.CONTACT}
              label={t('contactLink')}
              trailing='chevron'
            />
          </NavRowListMolecule>
        </div>
      </div>
    </PublicLayoutComposition>
  );
}
