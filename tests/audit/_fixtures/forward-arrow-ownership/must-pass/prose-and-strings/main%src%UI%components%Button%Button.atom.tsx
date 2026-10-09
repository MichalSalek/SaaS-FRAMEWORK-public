// Stub of the real primitive: the guard DISCOVERS button primitives as exported
// components of this directory that take a `direction` prop.
import type { ReactNode } from 'react';

interface ButtonProps {
  icon?: ReactNode;
  direction?: 'forward' | undefined;
  children?: ReactNode;
}

export function ButtonAtom({ icon, direction, children }: ButtonProps) {
  return (
    <button type='button'>
      {icon}
      {children}
      {direction === 'forward' ? '→' : null}
    </button>
  );
}
