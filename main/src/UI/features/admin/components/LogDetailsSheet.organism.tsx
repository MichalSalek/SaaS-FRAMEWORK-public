import { useLocale, useTranslations } from 'next-intl';
import { AppSheetAtom } from '../../../primitives/AppSheet.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { formatTimestamp } from '../../../../application/date/date.utils';
import { TypeBadgeMolecule } from '../AdminLogsPage.parts.molecule';
import { useAdminLogDetails } from '../hooks/useAdminLogDetails';
import {
  LogDetailsBodyOrganism,
  useCopyWithToast,
} from './LogDetailsBody.organism';

export function LogDetailsSheetOrganism({
  logId,
  onOpenLog,
  onClose,
}: {
  logId: string;
  onOpenLog: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.logs');
  const locale = useLocale();
  const details = useAdminLogDetails(logId, true);
  const record = details.data?.record;

  const copy = useCopyWithToast();

  const description = record
    ? `${formatTimestamp(record.created_at, locale)}, ${record.environment}, ${record.application}`
    : undefined;

  return (
    <AppSheetAtom
      open
      side='left'
      size='wide'
      title={
        record?.namespace ??
        (details.isLoading ? t('detailsLoading') : t('columnDetails'))
      }
      {...(description !== undefined && { description })}
      closeLabel={t('sheetClose')}
      headerExtra={
        record ? <TypeBadgeMolecule type={record.type} /> : undefined
      }
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}
      footer={
        record ? (
          <ButtonAtom
            size='sm'
            variant='ghost'
            onClick={() => void copy(JSON.stringify(record, null, 2))}>
            {t('copyJson')}
          </ButtonAtom>
        ) : null
      }>
      <LogDetailsBodyOrganism details={details} onOpenLog={onOpenLog} />
    </AppSheetAtom>
  );
}
