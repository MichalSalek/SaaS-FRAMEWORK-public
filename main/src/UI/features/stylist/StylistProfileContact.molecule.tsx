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
import page from './StylistProfilePage.module.css';

// DECISION (nie usuwaj tego komentarza) — głos ownera `s126-profil`,
// 2026-10-09: „DZIŚ, ale weź sekcję KONTAKT z wersji A”. Dzisiejszy układ
// profilu zostaje, a kontakt to JEDNA zatytułowana sekcja: telefon, strona
// i Instagram jako klikalne wiersze w jednym białym boksie. Zastąpiła kartę
// telefonu z wypełnionym przyciskiem „Zadzwoń” (drugi malinowy przycisk obok
// prośby o połączenie) oraz linki strony i Instagrama z paska pod imieniem:
// fakt „jak się z nią skontaktować” stoi na stronie raz.
//
// Wiersze to NavRowMolecule w NavRowListMolecule (głos `s126-wiersze`: jeden
// klikalny wiersz w produkcie), bez własnego CSS:
//  - telefon: `href` to `tel:` po odsłonięciu i `#` przed nim (prymityw
//    renderuje wtedy zwykłą kotwicę), a `onClick` dostaje zdarzenie i sam
//    dekoduje numer (`callStylistPhone`): klik jest zaufaną interakcją;
//  - strona i Instagram: `external`, czyli ExternalLinkAtom (`openExternalUrl`;
//    `target='_blank'` w skorupie Capacitora gubi sesję).
// Numer NIE potrzebuje `suppressHydrationWarning`: `useTrustedInteraction`
// startuje od `false` i przełącza się dopiero w efekcie, więc pierwszy render
// klienta („…”, `#`) jest identyczny z HTML-em serwera.

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
}

/**
 * „Kontakt” on the public stylist profile. Renders only the rows the stylist
 * filled in, and nothing at all (no title) when she filled in none.
 */
export function StylistProfileContactMolecule({
  encodedPhone,
  website,
  instagramHandle,
}: StylistProfileContactProps) {
  const t = useTranslations('stylist.contact');
  const websiteUrl = normalizeExternalHttpsUrl(website);
  const igHandle = instagramHandle?.replace(/^@/, '').trim() || null;

  if (!encodedPhone && !websiteUrl && !igHandle) {
    return null;
  }

  return (
    <section className={page.section}>
      <TypographyAtom variant='h2' className={page.sectionTitle}>
        {t('title')}
      </TypographyAtom>
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
      </NavRowListMolecule>
    </section>
  );
}
