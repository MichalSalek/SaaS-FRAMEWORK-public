import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SafeStylistAccount } from '@kernel/models/session/session.dto';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import {
  VALIDATION_LENGTHS,
  VALIDATION_SOCIAL,
} from '@kernel/policies/validation.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { normalizeInstagramHandle } from '../../auth/onboarding.helpers';

// HTML pattern attributes (regex source strings, not RegExp instances) mirror
// server-side validators in shared-kernel/policies/validation/account.validation.ts
// (VANITY_URL_FORMAT) and misc.validation.ts (INSTAGRAM_HANDLE).
const INSTAGRAM_PATTERN = `^[A-Za-z0-9._]{1,${VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX}}$`;
const VANITY_PATTERN = `^[a-z0-9-]{${VALIDATION_LENGTHS.VANITY_URL_MIN},${VALIDATION_LENGTHS.VANITY_URL_MAX}}$`;
import { StylistAvatarFieldOrganism } from './StylistAvatarField.organism';
import { ProfileSaveLineMolecule } from './StylistProfileSection.saveLine.molecule';
import { StylistBrandingFieldOrganism } from './StylistBrandingField.organism';
import { useUpdateStylistProfile } from '../hooks/useUpdateStylistProfile';
import { useSingleFlightSaves } from '../hooks/useSingleFlightSaves';
import styles from './StylistProfileSection.module.css';

interface StylistProfileSectionProps {
  stylistAccount: SafeStylistAccount;
}

type UpdateRequest = ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];

export function StylistProfileSectionOrganism({
  stylistAccount,
}: StylistProfileSectionProps) {
  const [bio, setBio] = useState(stylistAccount.description ?? '');
  const [city, setCity] = useState(stylistAccount.address_city ?? '');
  const [salonName, setSalonName] = useState(
    stylistAccount.business_name ?? ''
  );
  const [phone, setPhone] = useState(stylistAccount.phone ?? '');
  // DECISION (nie usuwaj tego komentarza) — 2026-09-09:
  // `website` istniało w bazie i w DTO aktualizacji, ale NIE MIAŁO pola w UI,
  // więc kolumna była nieustawialna. JSON-LD profilu też jej wtedy NIE emitował
  // (typ `StylistProfileData` deklarował pole, budowniczy węzła go nie czytał) —
  // wcześniejsza wersja tego komentarza twierdziła inaczej i była nieprawdziwa.
  // Od 2026-09-09 pole jest domknięte na wylot: wpisane tutaj trafia na profil
  // publiczny (pasek meta w StylistProfileHeader) ORAZ do `sameAs` węzła
  // NailSalon (_jsonld.helpers). Walidacja serwerowa wymaga pełnego https://
  // (validateOptionalHttpsUrl), stąd placeholder `https://` i podpowiedź pod
  // polem. Samo pole idzie `type='text'` + `inputMode='url'` — POWÓD tego
  // wyboru siedzi w komentarzu przy `<InputAtom>` niżej.
  const [website, setWebsite] = useState(stylistAccount.website ?? '');
  const [instagram, setInstagram] = useState(
    stylistAccount.instagram_handle ?? ''
  );
  const [vanityUrl, setVanityUrl] = useState(stylistAccount.vanity_url ?? '');
  // Branding-light: '' = kolor domyślny (deterministyczny cover z imienia).
  const [accentColor, setAccentColor] = useState(
    stylistAccount.brand_accent_color ?? ''
  );

  // DECISION (nie usuwaj tego komentarza):
  // Re-seed pól TYLKO przy zmianie TOŻSAMOŚCI konta (mount / become-user /
  // role-switch), NIE przy każdym refetchu tego samego konta. Autosave (poniżej)
  // woła updateProfile.mutate → onSuccess → invalidateStylistProfileCaches →
  // invaliduje queryKeys.account.current, które zasila `stylistAccount`
  // (user.stylist_account). Refetch daje NOWĄ referencję obiektu, więc
  // bezwarunkowy reset na [stylistAccount] nadpisywałby pole, które użytkownik
  // AKTUALNIE edytuje ale jeszcze nie zblurował/zapisał = cichy data-loss
  // (klasa S69; siostrzany ClientProfilePage chroni się analogicznym
  // isEditingRef). Guard na account_id: ten sam account → refetch po autosave =
  // no-op; po udanym zapisie prop już niesie zapisaną wartość, więc dirty-flagi
  // resetują się bez tego efektu. Świadomy trade-off: zewnętrzna zmiana pól
  // TEGO konta (np. admin) nie odświeży inputu do remountu — priorytetem jest
  // nietknięcie edycji in-progress.
  const syncedAccountIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (syncedAccountIdRef.current === stylistAccount.account_id) {
      return;
    }
    syncedAccountIdRef.current = stylistAccount.account_id;
    setBio(stylistAccount.description ?? '');
    setCity(stylistAccount.address_city ?? '');
    setSalonName(stylistAccount.business_name ?? '');
    setPhone(stylistAccount.phone ?? '');
    setWebsite(stylistAccount.website ?? '');
    setInstagram(stylistAccount.instagram_handle ?? '');
    setVanityUrl(stylistAccount.vanity_url ?? '');
    setAccentColor(stylistAccount.brand_accent_color ?? '');
  }, [stylistAccount]);

  const t = useTranslations('account.profile');
  const updateProfile = useUpdateStylistProfile();

  // DECISION (nie usuwaj tego komentarza) — census S126 (sf-profile), 2026-10-08:
  // konto BEZ adresu profilu nie ma czego udostępniać, więc pole adresu jest
  // wtedy pierwszym polem formularza i dostaje jedyny wypełniony przycisk
  // ekranu („Ustaw adres”). Wcześniej stała tam karta z przyciskiem „Ustaw
  // własny link”, który prowadził na TEN SAM ekran, a właściwe pole leżało
  // siedem pól niżej. Stan jest zatrzaśnięty przy montowaniu: po zapisaniu
  // adresu pole zostaje tam, gdzie je wypełniła, zamiast przeskoczyć na koniec.
  const [leadsWithAddress] = useState(() => !stylistAccount.vanity_url);

  const locationDirty =
    bio !== (stylistAccount.description ?? '') ||
    city !== (stylistAccount.address_city ?? '') ||
    salonName !== (stylistAccount.business_name ?? '') ||
    phone !== (stylistAccount.phone ?? '') ||
    website !== (stylistAccount.website ?? '');

  // Gate UI (twardy gate żyje na backendzie): kolor marki od Pro Marka.
  const canBrand =
    PRICING_POLICY.LIMITS[narrowPricingPlan(stylistAccount.pricing_plan)]
      .can_brand_profile;

  // AUTOSAVE (dyrektywa ownera 2026-07-12: „buttony ZAPISZ powinny zniknąć —
  // każda kontrolka zapisuje onBlur/onChange, mniej klików, toast po akcji").
  // Zapis per SEKCJA API przy opuszczeniu pola, TYLKO gdy sekcja dirty —
  // tabowanie przez niezmienione pola nie strzela requestami.
  //
  // DECISION (nie usuwaj tego komentarza): ZERO lokalnego onSuccess-toasta.
  // Sukces sygnalizuje interceptor http (onSuccessMainInterceptor → event-bus
  // pipeline Stage 1 → snackbar STYLIST_PROFILE_UPDATED) — lokalny push byłby
  // DRUGIM toastem tego samego eventu, dziś tłumionym tylko przez dedup
  // deduplikacji po message (kruche, S51c/S53). onError żyje w hooku (suppressGlobalError
  // + specyficzny toast) — TQ v5 odpala OBA poziomy, lokalny duplikat dawał 2
  // snackbary na jednym błędzie (S51).
  //
  // Zapisy single-flight z kolejką per sekcja (lost-update przy dwóch blurach
  // pod rząd) — mechanika i DECISION w useSingleFlightSaves.
  type SaveSection = 'location' | 'vanity' | 'social' | 'branding';
  const { save, retry, discard, isBusy, isSaving, failedSections } =
    useSingleFlightSaves<SaveSection, UpdateRequest>(updateProfile.mutateAsync);

  // Pole oddane do zapisanej wartości = nieudany snapshot sekcji nie jest już
  // niczyją intencją; ponowienie nie może go wskrzesić. Wyjątek: snapshot tej
  // sekcji jeszcze leci, wtedy cofnięcie trzeba WYSŁAĆ (DECISION 2026-09-25 w
  // useSingleFlightSaves), bo inaczej wygra wartość z lotu.
  const saveLocation = () => {
    if (!locationDirty && !isBusy('location')) {
      discard('location');
      return;
    }
    save('location', {
      location: {
        description: bio || null,
        address_city: city || null,
        business_name: salonName || null,
        address_street: stylistAccount.address_street,
        address_postal_code: stylistAccount.address_postal_code,
        address_country: stylistAccount.address_country,
        phone: phone || null,
        website: website || null,
      },
    });
  };

  const saveVanity = () => {
    // Adres profilu: serwer przyjmuje wyłącznie [a-z0-9-], więc spacje z
    // krańców znikają tutaj, a wielkie litery już przy wpisywaniu.
    const next = vanityUrl.trim();
    if (next !== vanityUrl) {
      setVanityUrl(next);
    }
    if (next === (stylistAccount.vanity_url ?? '') && !isBusy('vanity')) {
      discard('vanity');
      return;
    }
    save('vanity', { vanity: { vanity_url: next || null } });
  };

  const saveInstagram = () => {
    // Ta sama normalizacja co w onboardingu: „@anna.nails" i wklejony link
    // do profilu zapisują się jako sama nazwa konta.
    const next = normalizeInstagramHandle(instagram);
    if (next !== instagram) {
      setInstagram(next);
    }
    if (next === (stylistAccount.instagram_handle ?? '') && !isBusy('social')) {
      discard('social');
      return;
    }
    save('social', { social: { instagram_handle: next || null } });
  };

  // Swatch = zapis od razu z KLIKNIĘTĄ wartością (state jest asynchroniczny).
  const saveAccent = (hex: string) => {
    setAccentColor(hex);
    if (
      hex === (stylistAccount.brand_accent_color ?? '') &&
      !isBusy('branding')
    ) {
      discard('branding');
      return;
    }
    save('branding', { branding: { brand_accent_color: hex || null } });
  };

  // Enter w jednoliniowym polu = zatwierdź (blur odpala zapis) — bez tego
  // Enter nic nie robił, a nawyk „Enter = zapisz" jest powszechny.
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const addressField = (
    <div className={styles.field}>
      <InputAtom
        label={t('vanityUrlLabel')}
        value={vanityUrl}
        onChange={e =>
          setVanityUrl(
            e.target.value
              .toLowerCase()
              .slice(0, VALIDATION_LENGTHS.VANITY_URL_MAX)
          )
        }
        autoComplete='off'
        autoCapitalize='none'
        autoCorrect='off'
        spellCheck={false}
        maxLength={VALIDATION_LENGTHS.VANITY_URL_MAX}
        pattern={VANITY_PATTERN}
        error={failedSections.has('vanity') ? t('fieldNotSaved') : undefined}
        onBlur={() => saveVanity()}
        onKeyDown={blurOnEnter}
      />
      <p className={styles.hint}>{t('vanityHint')}</p>
      {leadsWithAddress && (
        // Kliknięcie zabiera fokus z pola, więc zapis wystartował już z blur;
        // przycisk dosyła go tylko wtedy, gdy nic nie leci (np. Enter + klik).
        <ButtonAtom
          variant='primary'
          size='md'
          className={styles.addressCta}
          loading={isSaving}
          disabled={vanityUrl.trim() === ''}
          onClick={() => {
            if (!isBusy('vanity')) {
              saveVanity();
            }
          }}>
          {t('vanitySetCta')}
        </ButtonAtom>
      )}
    </div>
  );

  return (
    <section className={styles.section} aria-labelledby='profile-form-title'>
      <div className={styles.head}>
        <TypographyAtom
          variant='h4'
          as='h2'
          id='profile-form-title'
          className={styles.heading}>
          {t('sectionTitle')}
        </TypographyAtom>
        <ProfileSaveLineMolecule
          isSaving={isSaving}
          hasFailure={failedSections.size > 0}
          onRetry={retry}
        />
      </div>

      <div className={styles.form}>
        {leadsWithAddress && addressField}

        {/* Zdjęcie profilowe stoi PRZED polami tekstowymi: to pierwsza rzecz,
            którą klientka widzi na wizytówce, a jego zapis nie jest autosave'em
            (własna mutacja + kadrowanie), więc nie miesza się z sekcjami. */}
        <StylistAvatarFieldOrganism stylistAccount={stylistAccount} />

        <InputAtom
          label={t('bioLabel')}
          multiline
          rows={3}
          value={bio}
          onChange={e =>
            setBio(e.target.value.slice(0, VALIDATION_LENGTHS.DESCRIPTION_MAX))
          }
          maxLength={VALIDATION_LENGTHS.DESCRIPTION_MAX}
          onBlur={() => saveLocation()}
        />
        <InputAtom
          label={t('cityLabel')}
          value={city}
          onChange={e =>
            setCity(e.target.value.slice(0, VALIDATION_LENGTHS.CITY_MAX))
          }
          maxLength={VALIDATION_LENGTHS.CITY_MAX}
          onBlur={() => saveLocation()}
          onKeyDown={blurOnEnter}
        />
        <InputAtom
          label={t('salonNameLabel')}
          value={salonName}
          onChange={e =>
            setSalonName(
              e.target.value.slice(0, VALIDATION_LENGTHS.BUSINESS_NAME_MAX)
            )
          }
          maxLength={VALIDATION_LENGTHS.BUSINESS_NAME_MAX}
          onBlur={() => saveLocation()}
          onKeyDown={blurOnEnter}
        />
        <div className={styles.field}>
          <InputAtom
            label={t('phoneLabel')}
            type='tel'
            inputMode='tel'
            value={phone}
            onChange={e =>
              setPhone(
                e.target.value.slice(0, VALIDATION_LENGTHS.PHONE_FIELD_MAX)
              )
            }
            maxLength={VALIDATION_LENGTHS.PHONE_FIELD_MAX}
            onBlur={() => saveLocation()}
            onKeyDown={blurOnEnter}
          />
          <p className={styles.hint}>{t('phoneHint')}</p>
        </div>
        <div className={styles.field}>
          <InputAtom
            label={t('websiteLabel')}
            // type='text' + inputMode='url': klawiatura adresowa na telefonie
            // bez natywnej walidacji `type='url'`, która przy autosave onBlur
            // biłaby się z komunikatem z backendu (jeden głos błędu).
            type='text'
            inputMode='url'
            placeholder='https://'
            value={website}
            onChange={e =>
              setWebsite(
                e.target.value.slice(0, VALIDATION_LENGTHS.WEBSITE_MAX)
              )
            }
            maxLength={VALIDATION_LENGTHS.WEBSITE_MAX}
            onBlur={() => saveLocation()}
            onKeyDown={blurOnEnter}
          />
          <p className={styles.hint}>{t('websiteHint')}</p>
        </div>
        {/* Bez maxLength: wklejony link do profilu na Instagramie jest dłuższy
            niż sama nazwa konta, a przycięty w locie nie dałby się już
            rozpakować (normalizacja przy zapisie, saveInstagram). Długość
            nazwy i tak sprawdza serwer. */}
        <InputAtom
          label={t('instagramLabel')}
          value={instagram}
          onChange={e => setInstagram(e.target.value)}
          autoComplete='off'
          autoCapitalize='none'
          autoCorrect='off'
          spellCheck={false}
          pattern={INSTAGRAM_PATTERN}
          error={failedSections.has('social') ? t('fieldNotSaved') : undefined}
          onBlur={() => saveInstagram()}
          onKeyDown={blurOnEnter}
        />

        {!leadsWithAddress && addressField}

        <StylistBrandingFieldOrganism
          accentColor={accentColor}
          canBrand={canBrand}
          onSelect={saveAccent}
        />
      </div>
    </section>
  );
}
