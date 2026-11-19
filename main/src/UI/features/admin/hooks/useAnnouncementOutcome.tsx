import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { OutcomeStateMolecule } from '../../../components/OutcomeFeedback/OutcomeState.molecule';
import type { AdminAnnouncement } from './useAdminAnnouncements';

export function useAnnouncementOutcome(rows: AdminAnnouncement[] | null) {
  const t = useTranslations('admin.announcements');
  const [receipt, setReceipt] = useState<{
    id: string;
    kind: 'saved' | 'sent';
    key: number;
  } | null>(null);
  const confirm = (id: string, kind: 'saved' | 'sent') => {
    setReceipt(current => ({ id, kind, key: (current?.key ?? 0) + 1 }));
  };
  const confirmed =
    receipt !== null &&
    rows !== null &&
    rows.some(
      row =>
        row.id === receipt.id &&
        (receipt.kind === 'saved' || row.notification_sent_at !== null)
    );
  return {
    saved: (id: string) => confirm(id, 'saved'),
    sent: (id: string) => confirm(id, 'sent'),
    clear: () => setReceipt(null),
    feedback: (
      <OutcomeStateMolecule
        confirmed={confirmed}
        animateOnConfirm
        completionKey={receipt?.key ?? 0}
        message={t(receipt?.kind === 'sent' ? 'sentReceipt' : 'savedReceipt')}
      />
    ),
  };
}
