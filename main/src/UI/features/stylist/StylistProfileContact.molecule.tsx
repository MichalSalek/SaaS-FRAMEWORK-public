import { useTranslations } from 'next-intl';
import {
  GlobeSimpleIcon,
  InstagramLogoIcon,
  PhoneCallIcon,
} from '@phosphor-icons/react';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { decodePii } from '../../components/Pii/pii.crypto';
import { useTrustedInteraction } from '../../shared/interaction/trusted-interaction';
import {
  PHONE_PLACEHOLDER,
  callStylistPhone,
} from './StylistPhoneContact.molecule';
import {
  formatExternalUrlLabel,
  normalizeExternalHttpsUrl,
} from './_website.helpers';
import {
  detectExternalLinkService,
  formatExternalLinkLabel,
  normalizeExternalLink,
} from '@kernel/domain/user-and-account/external-links.config';
import { ExternalLinkIconMolecule } from '../shared/profile/ExternalLinkIcon.molecule';
import page from './StylistProfilePage.module.css';

// DECISION: contact is ONE titled section (phone, website, Instagram as NavRow rows in one
// box), not a filled „Zadzwoń” button competing with the pairing CTA nor links under the
// name; the fact "how to reach her" appears on the page once (owner).
// The phone row uses `#` until a trusted interaction reveals `tel:`, so a bot never reads
// the number; it needs no `suppressHydrationWarning` because `useTrustedInteraction`
// starts `false` and flips in an effect. Website and Instagram go through `external`
// (`openExternalUrl`), since `target='_blank'` loses the session in the Capacitor shell.

function PhoneRow({ encPhone }: { encPhone: string }) {
  const t = useTranslations('stylist.contact');
  // Same reveal rule as StylistPhoneContactMolecule: a bot sees „…”.
  const revealed = useTrustedInteraction();
  return (
    <NavRowMolecule
      href={revealed ? `tel:${decodePii(encPhone)}` : '#'}
      onClick={event => callStylistPhone(event, encPhone)}
      icon={<PhoneCallIcon />}
      label={t('call')}
      description={revealed ? decodePii(encPhone) : PHONE_PLACEHOLDER}
      trailing='disc'
    />
  );
}

interface StylistProfileContactProps {
  /** Phone encoded server-side (PII); null when the stylist gave none. */
  encodedPhone: string | null;
  /** Raw `stylist_account.website`; shown only when it is a clean https URL. */
  website: string | null;
  /** Raw `stylist_account.instagram_handle`, with or without the leading @. */
  instagramHandle: string | null;
  /** Up to three https links; invalid values are filtered at render. */
  externalLinks?: string[];
}

/**
 * „Kontakt” on the public stylist profile. Renders only the rows the stylist
 * filled in, and nothing at all (no title) when she filled in none.
 */
export function StylistProfileContactMolecule({
  encodedPhone,
  website,
  instagramHandle,
  externalLinks = [],
}: StylistProfileContactProps) {
  const t = useTranslations('stylist.contact');
  const websiteUrl = normalizeExternalHttpsUrl(website);
  const igHandle = instagramHandle?.replace(/^@/, '').trim() || null;
  const instagramUrl = igHandle
    ? normalizeExternalLink(`https://instagram.com/${igHandle}`)
    : null;
  // A stylist may paste the same website or Instagram into the extra links;
  // the page shows each destination once.
  const links = externalLinks
    .map(link => normalizeExternalLink(link))
    .filter(
      (link): link is string =>
        link !== null && link !== websiteUrl && link !== instagramUrl
    );

  if (!encodedPhone && !websiteUrl && !igHandle && links.length === 0) {
    return null;
  }

  return (
    <section className={page.section}>
      <TypographyAtom variant='h2' className={page.sectionTitle}>
        {t('title')}
      </TypographyAtom>
      <div className={page.contactList}>
        <NavRowListMolecule ariaLabel={t('title')}>
          {encodedPhone && <PhoneRow encPhone={encodedPhone} />}
          {websiteUrl && (
            <NavRowMolecule
              href={websiteUrl}
              external
              icon={<GlobeSimpleIcon />}
              label={t('website')}
              description={formatExternalUrlLabel(websiteUrl)}
              trailing='disc'
            />
          )}
          {igHandle && (
            <NavRowMolecule
              href={`https://instagram.com/${igHandle}`}
              external
              icon={<InstagramLogoIcon />}
              label={t('instagram')}
              description={`@${igHandle}`}
              trailing='disc'
            />
          )}
          {links.map(link => {
            const service = detectExternalLinkService(link);
            return (
              <NavRowMolecule
                key={link}
                href={link}
                external
                icon={<ExternalLinkIconMolecule url={link} />}
                label={
                  service.id === 'website'
                    ? formatExternalLinkLabel(link)
                    : service.label
                }
                description={formatExternalLinkLabel(link)}
                trailing='disc'
              />
            );
          })}
        </NavRowListMolecule>
      </div>
    </section>
  );
}
