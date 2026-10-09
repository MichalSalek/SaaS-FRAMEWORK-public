import { ButtonAtom } from '../../components/Button/Button.atom';

// Wrong, kept as prose: <ButtonAtom icon={<ArrowRightIcon />}>Dalej</ButtonAtom>
export const WRONG_SAMPLE = "<ButtonAtom icon={<ArrowRightIcon />}>Dalej</ButtonAtom>";

export const Docs = () => (
  <ButtonAtom direction='forward'>
    {/* never: <ArrowRightIcon /> inside the label */}
    Dalej
  </ButtonAtom>
);
