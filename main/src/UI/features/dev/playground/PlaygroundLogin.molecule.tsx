import { useEffect, useState } from 'react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { devLogin_IO } from '../../../../domain/session/sessionIO.possibilities.api';
import { IS_DEVELOPMENT_ENV } from '../../../../application/environment/environment.possibilities.api';
import type { PlaygroundVote } from './playground.types';
import styles from './Playground.module.css';

/**
 * Who the frames are logged in as, and a one-click switch to the account the
 * vote needs. The frames share this origin's session, so a wrong login makes
 * every candidate show the wrong screen (S124: Test Stylist landed on
 * onboarding). Dev-login exists on DEVELOPMENT only; staging shows the hint.
 * A full reload after login, like the admin identity switch: every cache and
 * every frame starts from the new session.
 *
 * The session token lives in localStorage, which the server render cannot
 * see, so nothing session-dependent renders before mount: the first client
 * render must match the server HTML or React throws a hydration mismatch.
 */
export function PlaygroundLoginMolecule({
  loginAs,
}: {
  loginAs: NonNullable<PlaygroundVote['loginAs']>;
}) {
  const { data: user, isLoading, isError } = useCurrentUserAccount();
  const [mounted, setMounted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const current = user?.email ?? null;
  const matches = current === loginAs.email;

  const login = async () => {
    setPending(true);
    setFailed(false);
    try {
      await devLogin_IO({ email: loginAs.email });
      window.location.reload();
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <div className={styles.login} role='status'>
      <span>
        {!mounted || isLoading
          ? 'Sprawdzam, kto jest zalogowany…'
          : current === null
            ? // A failed session read is not "logged out": say so.
              isError
              ? 'Nie udało się sprawdzić sesji ramek.'
              : 'Ramki nie są zalogowane.'
            : `Ramki są zalogowane jako ${current}.`}{' '}
        {mounted && !matches && `Ten głos potrzebuje konta ${loginAs.label}.`}
        {failed && ' Logowanie nie wyszło, spróbuj ponownie.'}
      </span>
      {mounted && !isLoading && !matches && IS_DEVELOPMENT_ENV() && (
        <ButtonAtom
          variant='primary'
          size='sm'
          onClick={() => void login()}
          disabled={pending}
          aria-busy={pending}>
          {pending ? 'Loguję…' : `Zaloguj jako ${loginAs.label}`}
        </ButtonAtom>
      )}
    </div>
  );
}
