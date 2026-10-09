import { ArrowRightIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';

export const Step = () => (
  <ButtonAtom>
    <span>
      Przejdź dalej
      <ArrowRightIcon size={18} weight='bold' />
    </span>
  </ButtonAtom>
);
