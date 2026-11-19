import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceSlotAtom } from './PriceSlot.atom';

describe('PriceSlot monetary precision', () => {
  it('keeps cents in the accessible displayed amount', () => {
    render(
      <PriceSlotAtom
        value={12345}
        isLoading={false}
        locale='en'
        currency='usd'
        suffix='USD'
      />
    );
    expect(screen.getByText('123.45')).toBeInTheDocument();
  });

  it('uses the reading locale without changing the amount', () => {
    render(
      <PriceSlotAtom
        value={1905}
        isLoading={false}
        locale='pl'
        currency='usd'
        suffix='USD'
      />
    );
    expect(screen.getByText('19,05')).toBeInTheDocument();
  });
});
