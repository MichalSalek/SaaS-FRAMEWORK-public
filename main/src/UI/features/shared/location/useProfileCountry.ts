import { useEffect, useRef, useState } from 'react';
import {
  normalizeCountryCode,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import { useDetectedCountry } from './useDetectedCountry';

/** Saved country wins. A detection is only a suggestion until the user chooses or saves. */
export function useProfileCountry(
  saved: string | null | undefined,
  identity: string
) {
  const detected = useDetectedCountry();
  const [country, setCountry] = useState<CountryCode | ''>(
    () => normalizeCountryCode(saved) ?? ''
  );
  const [isManual, setIsManual] = useState(false);
  const identityRef = useRef(identity);
  const touchedRef = useRef(false);
  const sourceRef = useRef<'saved' | 'detected' | null>(
    normalizeCountryCode(saved) ? 'saved' : null
  );
  useEffect(() => {
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      touchedRef.current = false;
      setIsManual(false);
      sourceRef.current = null;
      setCountry('');
    }
    const stored = normalizeCountryCode(saved);
    if (!touchedRef.current && sourceRef.current !== 'saved' && stored) {
      sourceRef.current = 'saved';
      setCountry(stored);
      return;
    }
    const suggestion = normalizeCountryCode(detected.data?.country_code);
    if (!touchedRef.current && sourceRef.current === null && suggestion) {
      sourceRef.current = 'detected';
      setCountry(suggestion);
    }
  }, [identity, saved, detected.data?.country_code]);
  const chooseCountry = (next: CountryCode) => {
    touchedRef.current = true;
    setIsManual(true);
    setCountry(next);
  };
  const adoptCountryIfCurrent = (
    expected: CountryCode | '',
    next: CountryCode | ''
  ) => {
    setCountry(current => (current === expected ? next : current));
  };
  return { country, chooseCountry, adoptCountryIfCurrent, isManual };
}
