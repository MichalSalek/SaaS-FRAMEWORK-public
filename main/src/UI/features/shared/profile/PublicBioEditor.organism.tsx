// Public profile bio: ordinary edits save on blur; the private-note bridge
// opts into an explicit publication confirmation and never saves implicitly.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { AppParagraphLinkAtom } from '../../../components/AppParagraphLink/AppParagraphLink.atom';
import type {
  SafeCurrentUserWire,
  SafeStylistAccountWire,
} from '@kernel/domain/user/user.contract-schemas';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { authClient } from '../../../../application/auth/better-auth-client';
import { hasSessionToken } from '../../../shared/hooks/currentUser.query';
import { useLeaveGuard } from '../../../shared/hooks/useLeaveGuard';
import { isLeaveBypassed } from '../../../../application/routing/leave-guard';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useUpdateStylistProfile } from './hooks/useUpdateStylistProfile';
import { useSingleFlightSaves } from './hooks/useSingleFlightSaves';
import { ProfileSaveLineMolecule } from './ProfileSaveLine.molecule';
import { StylistBioFieldMolecule } from './StylistBioField.molecule';
import styles from './PublicBio.module.css';

type Common = {
  stylistAccount: SafeStylistAccountWire;
  hint?: string | null;
  showProfileLink?: boolean;
};
type Props = Common &
  (
    | {
        mode?: 'autosave';
        initialDraft?: never;
        saveVariant?: never;
        onSaved?: never;
      }
    | {
        mode: 'confirm-publication';
        initialDraft: string;
        saveVariant?: 'primary' | 'outlined';
        onSaved?: () => void;
      }
  );
type Request = ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];
const normalize = (text: string): string | null => text.trim() || null;

export function PublicBioEditorOrganism(props: Props) {
  return (
    <BioEditor
      key={`${props.stylistAccount.account_id}-${props.mode ?? 'autosave'}`}
      {...props}
    />
  );
}

function BioEditor(props: Props) {
  const { stylistAccount, hint } = props;
  const t = useTranslations('components.publicBio');
  const tProfile = useTranslations('account.profile');
  const tManage = useTranslations('account.profileManage');
  const cache = useQueryClient();
  const update = useUpdateStylistProfile();
  const session = authClient.useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [draft, setDraft] = useState(
    props.mode === 'confirm-publication'
      ? props.initialDraft
      : (stylistAccount.description ?? '')
  );
  const [confirmed, setConfirmed] = useState(
    normalize(stylistAccount.description ?? '')
  );
  const confirmedRef = useRef(confirmed);
  const draftRef = useRef(draft);
  const lastQueuedRef = useRef<string | null | undefined>(undefined);
  const discardedRef = useRef(false);
  draftRef.current = draft;
  const accountId = stylistAccount.account_id;
  const sameAccount = () => {
    const current = cache.getQueryData<SafeCurrentUserWire>(
      queryKeys.account.current
    );
    const activeSession = sessionRef.current;
    return (
      hasSessionToken() &&
      !activeSession.isPending &&
      !activeSession.error &&
      Boolean(activeSession.data?.user?.id) &&
      activeSession.data?.user?.id === current?.id &&
      current?.stylist_account?.account_id === accountId
    );
  };
  const saves = useSingleFlightSaves<'bio', Request>(async payload => {
    // A queued request must never use the session of a subsequently selected account.
    if (discardedRef.current || isLeaveBypassed() || !sameAccount()) {
      throw new Error('Profile identity changed');
    }
    await update.mutateAsync(payload);
    const next = payload.bio?.description ?? null;
    confirmedRef.current = next;
    setConfirmed(next);
  });
  const dirty = normalize(draft) !== confirmed;
  useLeaveGuard({
    when:
      props.mode !== 'confirm-publication' &&
      (dirty || saves.isSaving || saves.failedSections.has('bio')),
    message: tManage('bioUnsaved'),
  });
  const commit = () => {
    const next = normalize(draftRef.current);
    if (next === confirmedRef.current && !saves.isBusy('bio')) {
      saves.discard('bio');
      return;
    }
    lastQueuedRef.current = next;
    saves.save('bio', { bio: { description: next } });
  };
  // External refetches update clean fields only, preserving an in-progress edit.
  const lastServerRef = useRef(normalize(stylistAccount.description ?? ''));
  useEffect(() => {
    const next = normalize(stylistAccount.description ?? '');
    if (next === lastServerRef.current) {
      return;
    }
    lastServerRef.current = next;
    if (
      normalize(draftRef.current) === confirmedRef.current &&
      !saves.isBusy('bio')
    ) {
      confirmedRef.current = next;
      setConfirmed(next);
      setDraft(next ?? '');
    }
  }, [stylistAccount.description, saves]);
  const flushRef = useRef(() => {});
  flushRef.current = () => {
    if (
      props.mode === 'confirm-publication' ||
      isLeaveBypassed() ||
      !sameAccount()
    ) {
      return;
    }
    const next = normalize(draftRef.current);
    if (
      next !== lastQueuedRef.current &&
      (next !== confirmedRef.current || saves.isBusy('bio'))
    ) {
      commit();
    }
  };
  useEffect(
    () => () => {
      discardedRef.current = isLeaveBypassed();
      flushRef.current();
    },
    []
  );

  const publish = async () => {
    if (!sameAccount()) {
      return;
    }
    const next = normalize(draftRef.current);
    try {
      await update.mutateAsync({ bio: { description: next } });
      confirmedRef.current = next;
      setConfirmed(next);
      props.mode === 'confirm-publication' && props.onSaved?.();
    } catch {
      /* interceptor reports the error; retain the private draft */
    }
  };
  return (
    <div className={styles.editor}>
      <StylistBioFieldMolecule
        label={tProfile('bioLabel')}
        value={draft}
        onChange={setDraft}
        onBlur={props.mode === 'confirm-publication' ? undefined : commit}
        placeholder={t('placeholder')}
        hint={hint === null ? undefined : (hint ?? t('visibility'))}
      />
      {props.mode === 'confirm-publication' ? (
        <div className={styles.actions}>
          {!sameAccount() && <p role='status'>{tManage('sessionChecking')}</p>}
          <ButtonAtom
            type='button'
            variant={props.saveVariant ?? 'outlined'}
            size='md'
            loading={update.isPending}
            disabled={!dirty || !sameAccount()}
            onClick={() => void publish()}>
            {t('publish')}
          </ButtonAtom>
        </div>
      ) : (
        <ProfileSaveLineMolecule
          isSaving={saves.isSaving}
          isDirty={dirty}
          hasFailure={saves.failedSections.has('bio')}
          onRetry={commit}
        />
      )}
      {props.showProfileLink !== false && confirmed !== null && (
        <AppParagraphLinkAtom
          href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
            identifier: stylistAccount.vanity_url ?? stylistAccount.account_id,
          })}>
          {t('viewProfile')}
        </AppParagraphLinkAtom>
      )}
    </div>
  );
}
