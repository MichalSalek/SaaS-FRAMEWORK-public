import { CaretRightIcon as Next } from '@phosphor-icons/react';
import { ButtonAtom as Cta } from '../../components/Button/Button.atom';

export const Step = () => (
  <Cta
    icon={
      <Next
        size={14}
      />
    }>
    Następna
  </Cta>
);
