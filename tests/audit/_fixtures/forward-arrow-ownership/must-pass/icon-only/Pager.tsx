import { CaretRightIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';

export const Pager = () => (
  <ButtonAtom icon={<CaretRightIcon />} aria-label='Następna strona' />
);
