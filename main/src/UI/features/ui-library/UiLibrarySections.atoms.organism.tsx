import { useState } from 'react';
import { CompassIcon, PlusIcon, TrayIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { ChipAtom, ChipGroupMolecule } from '../../components/Chip/Chip.atom';
import { NumberMarkerAtom } from '../../components/NumberMarker/NumberMarker.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ProgressAtom } from '../../components/Progress/Progress.atom';
import { ToggleAtom } from '../../components/Toggle/Toggle.atom';
import { CheckboxAtom } from '../../components/Checkbox/Checkbox.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { SelectAtom } from '../../components/Select/Select.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ColorDotAtom } from '../../components/ColorDot/ColorDot.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { BrandMarkAtom } from '../../components/BrandMark/BrandMark.atom';
import { ATOM_ENTRIES } from './uiLibrary.registry';
import {
  LibraryEntryComposition,
  LibrarySectionComposition,
  DemoRowComposition,
} from './UiLibraryEntry.composition';
import styles from './UiLibraryPage.module.css';
import { AffordanceDiscAtom } from '../../components/AffordanceDisc/AffordanceDisc.atom';
import { UiLibraryDialogDemoOrganism } from './UiLibraryDialogDemo.organism';

/** Demo z lokalnym stanem — Toggle jest controlled (checked + onChange). */
function ToggleDemo() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <>
      <DemoRowComposition label='interaktywny'>
        <ToggleAtom
          label='Powiadomienia e-mail'
          checked={on}
          onChange={e => setOn(e.target.checked)}
        />
        <ToggleAtom
          label='Profil publiczny'
          checked={off}
          onChange={e => setOff(e.target.checked)}
        />
      </DemoRowComposition>
      <DemoRowComposition label='disabled'>
        <ToggleAtom label='Opcja zablokowana' checked disabled />
      </DemoRowComposition>
    </>
  );
}

/** Demo z lokalnym stanem — Checkbox jest controlled (checked + onChange);
 *  ptaszek renderuje się z propa checked, więc bez stanu byłby nieklikalny. */
function CheckboxDemo() {
  const [accept, setAccept] = useState(true);
  const [news, setNews] = useState(false);
  return (
    <>
      <DemoRowComposition label='interaktywny (z etykietą)'>
        <CheckboxAtom
          label='Akceptuję regulamin'
          checked={accept}
          onChange={e => setAccept(e.target.checked)}
        />
        <CheckboxAtom
          label='Chcę dostawać nowości'
          checked={news}
          onChange={e => setNews(e.target.checked)}
        />
      </DemoRowComposition>
      <DemoRowComposition label='bez etykiety, disabled'>
        <CheckboxAtom
          aria-label='Zaznacz pozycję'
          checked={accept}
          onChange={e => setAccept(e.target.checked)}
        />
        <CheckboxAtom label='Zaznaczony, zablokowany' checked disabled />
        <CheckboxAtom label='Pusty, zablokowany' disabled />
      </DemoRowComposition>
    </>
  );
}

export function UiLibrarySectionAtomsOrganism() {
  return (
    <LibrarySectionComposition id='atomy' title='Atomy'>
      <LibraryEntryComposition meta={ATOM_ENTRIES.dialog}>
        <UiLibraryDialogDemoOrganism />
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={ATOM_ENTRIES.button}>
        <DemoRowComposition label='warianty'>
          <ButtonAtom variant='primary'>Załóż konto</ButtonAtom>
          <ButtonAtom variant='outlined'>Zobacz cennik</ButtonAtom>
          <ButtonAtom variant='text'>Pomiń</ButtonAtom>
          <ButtonAtom variant='ghost'>Anuluj</ButtonAtom>
          <ButtonAtom variant='danger'>Usuń wpis</ButtonAtom>
        </DemoRowComposition>
        <DemoRowComposition label='rozmiary'>
          <ButtonAtom size='sm'>Mały</ButtonAtom>
          <ButtonAtom size='md'>Średni</ButtonAtom>
          <ButtonAtom size='lg'>Duży</ButtonAtom>
        </DemoRowComposition>
        <DemoRowComposition label='stany i ikona'>
          <ButtonAtom disabled>Niedostępny</ButtonAtom>
          <ButtonAtom icon={<PlusIcon size={16} />}>Dodaj zdjęcie</ButtonAtom>
          <ButtonAtom
            variant='outlined'
            icon={<PlusIcon size={16} />}
            ariaLabel='Dodaj'
          />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.brandMark}>
        <DemoRowComposition label='sygnet sam (stopka / bez nazwy) — para z nazwą = BrandLockup'>
          <BrandMarkAtom label='Nailfolio' className={styles.brandMarkDemoLg} />
          <BrandMarkAtom className={styles.brandMarkDemoMd} />
          <BrandMarkAtom className={styles.brandMarkDemoSm} />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.eyebrow}>
        <DemoRowComposition label='plain'>
          <EyebrowAtom>Jak to działa</EyebrowAtom>
        </DemoRowComposition>
        <DemoRowComposition label='chip'>
          <EyebrowAtom variant='chip'>
            Portfolio dla stylistek paznokci
          </EyebrowAtom>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.chip}>
        <DemoRowComposition label='rozmiary'>
          <ChipAtom label='Hybryda' />
          <ChipAtom label='Żel' size='sm' />
        </DemoRowComposition>
        <DemoRowComposition label='kolor i usuwanie'>
          <ChipGroupMolecule>
            <ChipAtom label='French' color='var(--color-secondary)' />
            <ChipAtom label='Babyboomer' onDelete={() => undefined} />
          </ChipGroupMolecule>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.numberMarker}>
        <DemoRowComposition label='sm (kanon kroków)'>
          <NumberMarkerAtom value={1} size='sm' />
          <NumberMarkerAtom value={2} size='sm' />
        </DemoRowComposition>
        <DemoRowComposition label='lg (tylko poza sekwencjami kroków)'>
          <NumberMarkerAtom value={7} />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.skeleton}>
        <DemoRowComposition label='rect / text / circle'>
          <SkeletonAtom width={180} height={96} />
          <SkeletonAtom variant='text' width={160} />
          <SkeletonAtom variant='circle' width={48} height={48} />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.progress}>
        <DemoRowComposition label='linear determinate (60%)'>
          <ProgressAtom value={60} ariaLabel='Postęp wgrywania' />
        </DemoRowComposition>
        <DemoRowComposition label='linear indeterminate'>
          <ProgressAtom ariaLabel='Ładowanie' />
        </DemoRowComposition>
        <DemoRowComposition label='spinner sm / md / lg'>
          <ProgressAtom variant='spinner' size='sm' ariaLabel='Ładowanie' />
          <ProgressAtom variant='spinner' size='md' ariaLabel='Ładowanie' />
          <ProgressAtom variant='spinner' size='lg' ariaLabel='Ładowanie' />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.toggle}>
        <ToggleDemo />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.checkbox}>
        <CheckboxDemo />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.input}>
        <DemoRowComposition label='tekst + błąd'>
          <InputAtom
            label='Imię'
            defaultValue='Marta'
            placeholder='Twoje imię'
          />
          <InputAtom
            label='E-mail'
            type='email'
            defaultValue='marta@'
            error='Podaj poprawny adres e-mail'
          />
        </DemoRowComposition>
        <DemoRowComposition label='search + multiline'>
          <InputAtom type='search' placeholder='Szukaj stylizacji' />
          <InputAtom
            multiline
            label='Notatka do wizyty'
            rows={3}
            defaultValue='Przedłużenie żelem, kolor nude.'
          />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.select}>
        <DemoRowComposition label='z wartością i z placeholderem'>
          <SelectAtom
            label='Długość paznokci'
            defaultValue='MEDIUM'
            options={[
              { value: 'SHORT', label: 'Krótkie' },
              { value: 'MEDIUM', label: 'Średnie' },
              { value: 'LONG', label: 'Długie' },
            ]}
          />
          <SelectAtom
            label='Plan'
            defaultValue=''
            placeholder='Wybierz plan'
            options={[
              { value: 'free', label: 'Free' },
              { value: 'pro', label: 'Pro' },
            ]}
          />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.typography}>
        <DemoRowComposition label='h1 / h2 / h3 / h4 (display serif, pełna skala)'>
          <div>
            <TypographyAtom variant='h1'>Portfolio paznokci</TypographyAtom>
            <TypographyAtom variant='h2'>Twoje portfolio</TypographyAtom>
            <TypographyAtom variant='h3'>Sekcja galerii</TypographyAtom>
            <TypographyAtom variant='h4'>Ostatnie stylizacje</TypographyAtom>
          </div>
        </DemoRowComposition>
        <DemoRowComposition label='body1 / body2 / subtitle / caption'>
          <div>
            <TypographyAtom variant='body1'>
              Klientki oglądają portfolio przed wizytą.
            </TypographyAtom>
            <TypographyAtom variant='body2'>
              Dodaj zdjęcia, które najlepiej pokazują Twój styl.
            </TypographyAtom>
            <TypographyAtom variant='subtitle'>Podtytuł sekcji</TypographyAtom>
            <TypographyAtom variant='caption'>Podpis pomocniczy</TypographyAtom>
          </div>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.affordanceDisc}>
        <DemoRowComposition label='sm (28 px) / md (32 px)'>
          <AffordanceDiscAtom size='sm' />
          <AffordanceDiscAtom />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.avatar}>
        <DemoRowComposition label='inicjały z tokenów (ton z imienia) sm / md / lg'>
          <AvatarAtom name='Marta Kowalska' size='sm' />
          <AvatarAtom name='Test Stylist' size='md' />
          <AvatarAtom name='Anna Nowak' size='lg' />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.colorDot}>
        <DemoRowComposition label='rozmiary sm (12px) / md (16px) / quick (24px) / lg (40px) + biały (rama)'>
          <ColorDotAtom color='#a32638' size='sm' />
          <ColorDotAtom color='#a32638' size='md' />
          <ColorDotAtom color='#a32638' size='quick' />
          <ColorDotAtom color='#e8b4c8' size='lg' />
          <ColorDotAtom color='#ffffff' size='lg' />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={ATOM_ENTRIES.emptyState}>
        <DemoRowComposition label='size="page" — pusty jest cały widok (medalion 96px, nagłówek płynny, ruch „float")' />
        <EmptyStateAtom
          size='page'
          icon={<CompassIcon size={44} weight='duotone' />}
          animate='float'
          title='Jeszcze nic tu nie ma'
          titleAs='h3'
          description='Zapisane stylizacje pojawią się tutaj, gdy polubisz pierwszą pracę.'
          action={
            <ButtonAtom variant='primary' size='lg'>
              Przeglądaj inspiracje
            </ButtonAtom>
          }
        />
        <DemoRowComposition label='size="panel" — pusta sekcja w zapełnionym widoku (medalion 64px, bez CTA)' />
        <EmptyStateAtom
          icon={<TrayIcon size={28} weight='duotone' />}
          title='Brak zgłoszeń'
          description='Nic nie czeka na moderację. Nowe zgłoszenia trafią na tę listę.'
        />
      </LibraryEntryComposition>
    </LibrarySectionComposition>
  );
}
