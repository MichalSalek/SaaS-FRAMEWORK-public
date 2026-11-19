// UI/features/shared/profile/ProfileLinkCard.organism.tsx
// The head of both public-profile screens (the stylist's own and the salon's):
// the public address and, first of all, „Zobacz profil”.
//
// DECISION: both profile screens open with the public-link card, so preview is visible before
// the editor. The address copies itself; preview and sharing stay together below it. A profile
// that does not exist yet keeps preview visible and disabled with an explanation. (owner)
import { Fragment, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, CopyIcon, EyeIcon } from '@phosphor-icons/react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { useProfileLinkActions } from './useProfileLinkActions';
import styles from './ProfileShareCard.module.css';

/** The full address; it breaks only after a slash, never inside a word. */
function ProfileUrlText({ displayUrl }: { displayUrl: string }) {
  return (
    <span className={styles.url}>
      {displayUrl.split('/').map((part, index, parts) => (
        <Fragment key={`${String(index)}-${part}`}>
          {part}
          {index < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** The full address is the copy target; success changes only its trailing glyph. */
export function ProfileUrlCopyRow({
  displayUrl,
  copied,
  onCopy,
}: {
  displayUrl: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const t = useTranslations('components.profileShare');
  return (
    <>
      <ButtonAtom
        variant='text'
        size='sm'
        className={styles.address}
        ariaLabel={`${t('copyAction')}: ${displayUrl}`}
        onClick={onCopy}>
        <span className={styles.urlContent}>
          <ProfileUrlText displayUrl={displayUrl} />
          <span className={styles.copyGlyph} aria-hidden='true'>
            <CopyIcon data-shown={copied ? undefined : ''} />
            <CheckIcon data-shown={copied ? '' : undefined} />
          </span>
        </span>
      </ButtonAtom>
      <span className='sr-only' role='status'>
        {copied ? t('copiedLabel') : ''}
      </span>
    </>
  );
}

function ViewProfileButton({ href }: { href: string | null }) {
  const t = useTranslations('components.profileShare');
  const icon = <EyeIcon aria-hidden='true' />;
  return href ? (
    <LinkButtonAtom
      href={href}
      variant='outlined'
      size='sm'
      icon={icon}
      className={styles.action}>
      {t('previewAction')}
    </LinkButtonAtom>
  ) : (
    <ButtonAtom
      variant='outlined'
      size='sm'
      icon={icon}
      disabled
      className={styles.action}>
      {t('previewAction')}
    </ButtonAtom>
  );
}

function SharedLink({
  path,
  target,
}: {
  path: string;
  target: 'stylist' | 'salon';
}) {
  const t = useTranslations('components.profileShare');
  const link = useProfileLinkActions(path, target);
  // Copy belongs to the address; preview and share keep one compact action row.
  return (
    <>
      <ProfileUrlCopyRow
        displayUrl={link.displayUrl}
        copied={link.copied}
        onCopy={() => void link.copy()}
      />
      <div className={styles.actions}>
        <ViewProfileButton href={path} />
        <ButtonAtom
          variant='primary'
          size='sm'
          className={styles.action}
          onClick={() => void link.share()}>
          {t('shareAction')}
        </ButtonAtom>
      </div>
    </>
  );
}

export function ProfileLinkCardOrganism({
  target,
  viewPath,
  sharePath,
  notice,
  title,
  outcome,
}: {
  target: 'stylist' | 'salon';
  /** Overrides the heading, e.g. with the state of a profile not published yet. */
  title?: string;
  /** Where „Zobacz profil” leads; null = the public profile does not exist yet. */
  viewPath: string | null;
  /** The address to copy and send; null = nothing worth sending yet. */
  sharePath: string | null;
  /** Said instead of the address when there is nothing to send yet. */
  notice?: string;
  /** The result of a step that just made the profile public (L2, on this card). */
  outcome?: ReactNode;
}) {
  const t = useTranslations('components.profileShare');
  return (
    <section className={`${styles.card} ${styles.linkCard}`}>
      <TypographyAtom variant='h4' as='h2' className={styles.title}>
        {title ?? t(target === 'salon' ? 'salonLinkTitle' : 'linkTitle')}
      </TypographyAtom>
      {outcome}
      {sharePath ? (
        <SharedLink path={sharePath} target={target} />
      ) : (
        <>
          {notice && (
            <TypographyAtom variant='body2' className={styles.body}>
              {notice}
            </TypographyAtom>
          )}
          <div className={styles.actions}>
            <ViewProfileButton href={viewPath} />
          </div>
        </>
      )}
    </section>
  );
}
