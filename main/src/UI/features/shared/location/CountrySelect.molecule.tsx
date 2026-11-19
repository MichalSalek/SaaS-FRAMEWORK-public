import { useMemo, useSyncExternalStore } from 'react';
import { useLocale } from 'next-intl';
import {
  COUNTRY_CODES,
  countryDisplayName,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import {
  SelectAtom,
  type SelectProps,
} from '../../../components/Select/Select.atom';

type Props = Omit<SelectProps<CountryCode>, 'options'>;

const subscribe = () => () => undefined;
const browserSnapshot = () => true;
const serverSnapshot = () => false;

export function CountrySelectMolecule(props: Props) {
  const locale = useLocale();
  // Node and browsers can carry different CLDR names. First hydrate the same
  // placeholder, then build the native picker labels using the browser's data.
  const hydrated = useSyncExternalStore(
    subscribe,
    browserSnapshot,
    serverSnapshot
  );
  const options = useMemo(
    () =>
      (hydrated ? COUNTRY_CODES : [])
        .map(value => ({
          value,
          label: countryDisplayName(value, locale),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [locale, hydrated]
  );
  return <SelectAtom {...props} options={options} autoComplete='country' />;
}
