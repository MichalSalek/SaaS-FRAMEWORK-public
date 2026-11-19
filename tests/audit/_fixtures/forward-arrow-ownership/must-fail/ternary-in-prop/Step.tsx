import { ArrowRightIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';

export const Step = ({ busy }: { busy: boolean }) => (
  <ButtonAtom icon={busy ? <span /> : <ArrowRightIcon />}>Dalej</ButtonAtom>
);
