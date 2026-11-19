import { getSalonProfilePath } from '@kernel/domain/salon-profile/salon.urls';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { SystemNoticeOrganism } from '../../components/SystemNotice/SystemNotice.organism';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { buildAccountSectionHref } from '../../../application/policies/account-sections.config';
import styles from './SalonProfileManage.module.css';
export function SalonInactiveOrganism({
  profile,
}: {
  profile: SalonProfileData;
}) {
  const setup = useTranslations('salon.setup');
  return (
    <div className={styles.setup}>
      <SystemNoticeOrganism
        titleId='salon-inactive'
        title={setup('inactiveTitle')}
        body={setup('inactiveBody')}
        actions={
          <LinkButtonAtom
            variant='primary'
            href={buildAccountSectionHref('plan')}>
            {setup('restore')}
          </LinkButtonAtom>
        }
      />
      <NavRowListMolecule>
        <NavRowMolecule
          href={ROUTES_FRONT.SALON_STAFF}
          label={setup('teamTitle')}
          description={setup('inactiveTeam')}
          trailing='disc'
        />
      </NavRowListMolecule>
      <div className={styles.form}>
        <TypographyAtom variant='h4' as='h2'>
          {profile.name}
        </TypographyAtom>
        <TypographyAtom>
          {profile.salon_vanity_url
            ? getSalonProfilePath(profile)
            : setup('todo')}
        </TypographyAtom>
        <TypographyAtom>
          {setup('retained', { count: profile.works.length })}
        </TypographyAtom>
      </div>
    </div>
  );
}
