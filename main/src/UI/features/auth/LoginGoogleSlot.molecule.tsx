import type { useTranslations } from 'next-intl';
import { GoogleLogoAtom } from './GoogleLogo.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { useHydrated } from '../../hooks/useHydrated';
import { isEmbeddedSocialBrowser } from '../../../application/platform/embedded-browser';
import type { SocialProvider } from '../../../application/auth/social-signin';
import styles from './LoginPage.module.css';

type LoginT = ReturnType<typeof useTranslations<'pages.login'>>;

/** Google OAuth is replaced in Instagram and Facebook browsers. Magic link stays. */
export function LoginGoogleSlotMolecule({
  socialLoading,
  onSocialSignIn,
  t,
}: {
  socialLoading: SocialProvider | null;
  onSocialSignIn: (provider: SocialProvider) => void;
  t: LoginT;
}) {
  const hydrated = useHydrated();
  const embedded =
    hydrated && isEmbeddedSocialBrowser(window.navigator.userAgent);
  if (embedded) {
    return (
      <p className={styles.embeddedNotice}>{t('embeddedBrowserGoogle')}</p>
    );
  }
  return (
    <ButtonAtom
      variant='outlined'
      size='lg'
      className={`${styles.submitButton} press-feedback`}
      disabled={socialLoading !== null && socialLoading !== 'google'}
      loading={socialLoading === 'google'}
      icon={<GoogleLogoAtom />}
      onClick={() => onSocialSignIn('google')}>
      {socialLoading === 'google' ? t('socialPending') : t('googleBtn')}
    </ButtonAtom>
  );
}
