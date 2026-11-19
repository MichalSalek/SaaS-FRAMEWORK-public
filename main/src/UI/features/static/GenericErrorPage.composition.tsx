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

interface GenericErrorPageProps {
  /** Optional HTTP status code displayed inline (e.g. 400, 403, 502). */
  statusCode?: number | null;
}

/**
 * Generic catch-all error page used by Pages Router `_error.tsx`.
 *
 * Smaller, simpler sibling of `ServerErrorPage` — same brand vocabulary,
 * but minimal footprint because this page renders for arbitrary
 * unexpected error states (network glitches, prop-tunnel failures,
 * unmatched server-side throws).
 *
 * DECISION: the status code is one quiet line under the actions („Kod błędu 502”), not
 * a numeral or a chip: this page is the "generic unexpected error", and the
 * code is technical context for support, not the message.
 */
export function GenericErrorPageComposition({
  statusCode = null,
}: GenericErrorPageProps) {
  const t = useTranslations('static.genericError');

  // No random „ID błędu" and no raw exception message: the ID reached no log
  // (a display lie), and an SSR `err.message` leaked internals (paths, module
  // names) to the browser. The error trail = PostHog + Event Log Store.
  const handleRetry = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <PublicLayoutComposition>
      <div className={notice.page}>
        <SystemNoticeOrganism
          titleId='generic-error-heading'
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
          {...(statusCode != null
            ? { meta: t('statusCode', { code: statusCode }) }
            : {})}
        />

        <div className={notice.links}>
          <NavRowListMolecule ariaLabel={t('contactSupport')}>
            <NavRowMolecule
              href={ROUTES_FRONT.CONTACT}
              label={t('contactSupport')}
              trailing='chevron'
            />
          </NavRowListMolecule>
        </div>
      </div>
    </PublicLayoutComposition>
  );
}
