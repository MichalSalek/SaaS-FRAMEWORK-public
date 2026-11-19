import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import {
  renderWithProviders,
  makeTestQueryClient,
} from './renderWithProviders';

// W0.1 smoke: proves the Vitest + RTL + provider tree wiring works and that
// each render gets a FRESH QueryClient (no cross-test cache leak).
describe('test infra (W0.1)', () => {
  it('renders a component inside the provider tree', () => {
    renderWithProviders(<button>ping</button>);
    expect(screen.getByRole('button', { name: 'ping' })).toBeInTheDocument();
  });

  it('hands back a distinct QueryClient per render (no singleton leak)', () => {
    const a = renderWithProviders(<span>a</span>);
    const b = renderWithProviders(<span>b</span>);
    expect(a.queryClient).not.toBe(b.queryClient);
  });

  it('makeTestQueryClient disables retry', () => {
    const qc = makeTestQueryClient();
    expect(qc.getDefaultOptions().queries?.retry).toBe(false);
    expect(qc.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
