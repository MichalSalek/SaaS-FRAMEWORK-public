import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionContainerLifecycleStateValue as State } from '@kernel/models/db_models.generated.dto';
import { DetailStylistCreditMolecule } from './ClientSessionDetailPage.blocks.molecule';
import type { TSessions } from './sessionTime.formatters';

vi.mock('next/router', () => ({ useRouter: () => ({ locale: 'pl' }) }));

const t = ((key: string) => key) as TSessions;
const props = {
  hasStylist: true,
  stylistDisplayName: 'Anna',
  stylistAvatarUrl: null,
  fallbackName: 'Stylistka',
  stylistMessagePairId: 'pair-2',
  t,
};

describe('stylist credit message action', () => {
  it.each([State.SHARED, State.ACTIVE])('links to the pair in %s', state => {
    render(<DetailStylistCreditMolecule {...props} lifecycleState={state} />);
    expect(
      screen.getByRole('link', { name: 'detailMessageStylist' })
    ).toHaveAttribute('href', '/app/messages/pair-2?fromSession=1');
    expect(screen.getByText('Anna')).toBeInTheDocument();
  });

  it.each([State.DRAFT, State.READY, State.CLOSED, State.EXPIRED])(
    'does not offer messaging in %s',
    state => {
      render(<DetailStylistCreditMolecule {...props} lifecycleState={state} />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    }
  );

  it('keeps the fallback and hides the link without a resolved pair', () => {
    render(
      <DetailStylistCreditMolecule
        {...props}
        lifecycleState={State.SHARED}
        stylistDisplayName={null}
        stylistMessagePairId={undefined}
      />
    );
    expect(screen.getByText('Stylistka')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
