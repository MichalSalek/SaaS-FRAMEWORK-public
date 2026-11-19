import { useTranslations } from 'next-intl';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';

export function SessionAcceptanceStatusMolecule({
  acceptedAt,
  changedAt,
  viewedAt,
}: {
  acceptedAt?: string | null | undefined;
  changedAt?: string | null | undefined;
  /** First stylist read; independent from acceptance. */
  viewedAt?: string | null | undefined;
}) {
  const t = useTranslations('pages.sessions');
  if (!acceptedAt && !viewedAt) {
    return null;
  }
  const changed =
    acceptedAt != null &&
    changedAt != null &&
    Date.parse(changedAt) > Date.parse(acceptedAt);
  return (
    <>
      {/* Acceptance implies a read: the second pill would only repeat it. */}
      {viewedAt && !acceptedAt && (
        <StatusPillAtom
          color='var(--color-text-secondary)'
          label={t('sessionViewed')}
        />
      )}
      {acceptedAt && (
        <StatusPillAtom
          color='var(--color-text-secondary)'
          label={
            changed ? t('changesAfterAcceptance') : t('inspirationsAccepted')
          }
        />
      )}
    </>
  );
}
