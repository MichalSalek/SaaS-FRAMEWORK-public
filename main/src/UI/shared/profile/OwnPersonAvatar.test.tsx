import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OwnPersonAvatarMolecule } from './OwnPersonAvatar.molecule';

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError: () => void;
  }) => createElement('img', { src, alt, onError }),
}));

describe('personal identity photo', () => {
  it('falls through custom, provider and canonical initials, then recovers for a new URL', () => {
    const person = {
      name: 'Anna Nowak',
      avatar_url: '/custom.jpg',
      image: '/provider.jpg',
    };
    const view = render(<OwnPersonAvatarMolecule person={person} size='sm' />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/custom.jpg');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/provider.jpg');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveTextContent('AN');
    view.rerender(
      <OwnPersonAvatarMolecule
        person={{ ...person, avatar_url: '/new.jpg' }}
        size='sm'
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', '/new.jpg');
    view.rerender(
      <OwnPersonAvatarMolecule
        person={{
          ...person,
          avatar_url: '/new.jpg',
          image: '/refreshed-provider.jpg',
        }}
        size='sm'
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', '/new.jpg');
  });
});
