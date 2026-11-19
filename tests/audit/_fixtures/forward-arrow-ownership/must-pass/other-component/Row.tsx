import type { ReactNode } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react';

const Row = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <div>
    {icon}
    {children}
  </div>
);

export const Usage = () => <Row icon={<ArrowRightIcon />}>Przenieś</Row>;
