import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { SoftBreakTextAtom } from './SoftBreakText.atom';

describe('SoftBreakTextAtom', () => {
  it('keeps the text and offers a break after each separator', () => {
    const { container } = renderWithProviders(
      <SoftBreakTextAtom>ACCOUNT_CHECKOUT_SESSION</SoftBreakTextAtom>
    );
    expect(container.textContent).toBe('ACCOUNT_CHECKOUT_SESSION');
    expect(container.querySelectorAll('wbr')).toHaveLength(2);
  });

  it('breaks an e-mail at its joints, not inside the domain', () => {
    const { container } = renderWithProviders(
      <SoftBreakTextAtom>temp-owner@example.com</SoftBreakTextAtom>
    );
    expect(container.textContent).toBe('temp-owner@example.com');
    expect(container.innerHTML).toContain('@<wbr>example.<wbr>com');
  });

  it('adds nothing to a plain word', () => {
    const { container } = renderWithProviders(
      <SoftBreakTextAtom>Karolina</SoftBreakTextAtom>
    );
    expect(container.querySelectorAll('wbr')).toHaveLength(0);
  });
});
