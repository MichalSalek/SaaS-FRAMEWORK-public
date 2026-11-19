import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VisitRecordSourceValue } from '@kernel/models/db_models.generated.dto';
import type { VisitRecordDTO } from '@kernel/models/visit/visit.dto';
import { VisitCardMolecule } from './ClientCardPage.visit-card.molecule';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'pl',
}));
vi.mock('./hooks/useUploadResultPhoto', () => ({
  useUploadResultPhoto: () => ({
    isPending: false,
    isSuccess: false,
    mutate: vi.fn(),
  }),
}));
const summary = vi.hoisted(() => ({
  data: undefined as
    { photoUrls: string[]; clientNote: string | null } | undefined,
}));
vi.mock('./hooks/useVisitSessionSummary', () => ({
  useVisitSessionSummary: () => summary,
}));

const visit = (source: VisitRecordDTO['source']): VisitRecordDTO => ({
  id: 'visit_1',
  clientUserId: 'usr_1',
  visitDate: '2026-10-01T10:00:00.000Z',
  serviceNote: null,
  source,
  sessionId: source === VisitRecordSourceValue.SESSION ? 'sess_1' : null,
  resultPhotos: [],
  createdAt: '2026-10-01T10:00:00.000Z',
});

const renderCard = (source: VisitRecordDTO['source']) =>
  render(
    <VisitCardMolecule
      visit={visit(source)}
      clientUserId='usr_1'
      onUpdateNote={vi.fn()}
      onRemovePhoto={vi.fn()}
      onDeleteVisit={vi.fn()}
    />
  );

describe('visit card: the client session note', () => {
  it('shows the client note of the session, labelled as hers', () => {
    summary.data = { photoUrls: [], clientNote: 'Chcę coś na wesele' };
    renderCard(VisitRecordSourceValue.SESSION);
    expect(screen.getByText('clientSessionNoteLabel')).toBeTruthy();
    expect(screen.getByText('Chcę coś na wesele')).toBeTruthy();
  });

  it('shows nothing when the session has no client note', () => {
    summary.data = { photoUrls: [], clientNote: null };
    renderCard(VisitRecordSourceValue.SESSION);
    expect(screen.queryByText('clientSessionNoteLabel')).toBeNull();
  });
});
