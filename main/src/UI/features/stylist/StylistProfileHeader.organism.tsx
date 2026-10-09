import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { LinkBreakIcon, MapPinIcon } from '@phosphor-icons/react';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { isBrandAccentHex } from '@kernel/domain/user-and-account/branding.config';
import { coverHueVars } from '../shared/gallery/coverHueVars';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import styles from './StylistProfilePage.module.css';

type AccountData =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE']['account'];

interface StylistProfileHeaderProps {
  account: AccountData;
  isPaired: boolean;
  onUnpairRequest: () => void;
}

export function StylistProfileHeaderOrganism({
  account,
  isPaired,
  onUnpairRequest,
}: StylistProfileHeaderProps) {
  const t = useTranslations('stylist.actions');
  const tLabels = useTranslations('labels');

  const displayName =
    account.display_name || account.business_name || tLabels('stylistFallback');
  const businessName = account.business_name;
  const city = account.address_city;
  // DECISION (nie usuwaj tego komentarza) — głos ownera `s126-profil`,
  // 2026-10-09: pod imieniem zostaje samo MIASTO. Strona i Instagram mieszkały
  // tu jako linki w pasku meta (decyzja 2026-09-09); po głosie mają własne
  // wiersze w sekcji „Kontakt” (StylistProfileContactMolecule) i nie wracają
  // do nagłówka, bo ten sam fakt stałby na stronie dwa razy.
  const showBusinessName =
    Boolean(businessName) && businessName !== displayName;

  return (
    <section
      className={styles.profileHero}
      style={
        {
          ...coverHueVars(displayName || account.account_id),
          // Branding-light (Pro Marka+): wybrany kolor marki NADPISUJE
          // deterministyczny cover-hue z imienia — cover band to najbardziej
          // widoczny element profilu. --cover-mix podbity, bo domyślne 18%
          // rozcieńczało kuratorowany kolor do nierozróżnialnej mgiełki
          // (picker obiecywał nasycony kolor, profil pokazywał pastel).
          // isBrandAccentHex = defense-in-depth przy renderze wartości z DB
          // (write-path waliduje, ale render nie powinien ufać w ciemno).
          // DECISION (nie usuwaj tego komentarza): kolor marki barwi profil
          // publiczny ORAZ kartę Explore (StylistCard: brand_accent_color z DTO
          // listy, krok 2 dowieziony); galeria (StylistExhibitHero) nadal liczy
          // hue z imienia — rozszerzenie wymaga koloru w DTO galerii.
          ...(account.brand_accent_color &&
          isBrandAccentHex(account.brand_accent_color)
            ? {
                ['--cover-hue']: account.brand_accent_color,
                // 100% = PEŁNY kolor marki (color-blocking, zero rozcieńczenia):
                // kuratorowana paleta to ciemne tony, więc biały eyebrow ma AA
                // na KAŻDYM kolorze (najjaśniejszy terracotta = 5.55:1; przy
                // mix 80% terracotta/olive/teal spadały pod 4.5 — Codex S51).
                // Mid-tone mixy 46-80% = strefa, gdzie ani ciemny, ani jasny
                // tekst nie przechodzi.
                ['--cover-mix']: '100%',
                ['--cover-mix-dark']: '100%',
              }
            : {}),
        } as CSSProperties
      }
      data-branded={
        account.brand_accent_color &&
        isBrandAccentHex(account.brand_accent_color)
          ? ''
          : undefined
      }>
      {isPaired && (
        <div className={styles.profileMenuWrapper}>
          <AppMenuAtom>
            <AppMenuAtom.MoreTrigger label={t('moreMenuAriaLabel')} />
            <AppMenuAtom.Content side='bottom' align='end'>
              <AppMenuAtom.Item tone='danger' onClick={onUnpairRequest}>
                <LinkBreakIcon size={16} />
                <span>{t('unpairMenu')}</span>
              </AppMenuAtom.Item>
            </AppMenuAtom.Content>
          </AppMenuAtom>
        </div>
      )}

      {/* Nagłówek: awatar obok imienia (S118, bez pasa okładki) */}
      <div className={styles.profileBody}>
        <div className={styles.profileAvatar}>
          <AvatarAtom
            src={account.avatar_url ?? undefined}
            name={displayName}
            size='lg'
          />
        </div>

        <div className={styles.profileMeta}>
          {/* Marcellus serif name — canonical heading font for exhibit hero */}
          <h1 className={styles.profileName}>{displayName}</h1>
          {showBusinessName && (
            <p className={styles.profileBusinessName}>{businessName}</p>
          )}
        </div>

        {city && (
          <div className={styles.profileInlineMeta}>
            <span className={styles.profileMetaItem}>
              <MapPinIcon size={14} weight='fill' aria-hidden='true' />
              {city}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
