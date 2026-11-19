import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuccessSceneOrganism } from './SuccessScene.organism';

describe('SuccessScene presentations', () => {
  it('renders the glory band as a labelled section with h2 when asked', () => {
    const { container } = render(
      <SuccessSceneOrganism
        presentation='glory'
        actionDock
        titleAs='h2'
        title='Konto jest gotowe'
        body='Możesz zacząć.'
        actions={<button type='button'>Dodaj pierwszą pracę</button>}
      />
    );
    const section = container.querySelector('[data-presentation="glory"]');
    expect(section).not.toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Konto jest gotowe' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dodaj pierwszą pracę' })
    ).toBeInTheDocument();
  });

  it('keeps the plain presentation for quiet confirmations', () => {
    const { container } = render(
      <SuccessSceneOrganism
        title='Sprawdź skrzynkę'
        actions={<button type='button'>Wyślij ponownie</button>}
      />
    );
    expect(
      container.querySelector('[data-presentation="plain"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-presentation="glory"]')).toBeNull();
  });
});
