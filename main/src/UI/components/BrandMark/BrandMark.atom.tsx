import { LP_ASSETS } from '../../assets/lpAssets';
/**
 * BrandMarkAtom — SSOT sygnetu marki (znak „nf").
 *
 * JEDYNE źródło ścieżki i sposobu renderowania oficjalnego brand-marku.
 * Wszystkie powłoki (navbar, rail konta, stopka, login, ekrany systemowe)
 * renderują markę PRZEZ ten atom — zmiana logo (plik / format / intrinsic
 * size) = edycja jednego pliku, zero rozjazdu między powierzchniami.
 *
 * Rozmiar NIE jest tu ustalany — steruje nim `className` konsumenta (rozmiar
 * jest layout-specyficzny: mniejszy w compact-barze, większy na mastheadzie).
 *
 * A11y: sygnet jest domyślnie DEKORACYJNY (`alt=''`), bo zwykle stoi obok
 * wordmarku „Nailfolio", który niesie nazwę dla czytników. Na powierzchniach
 * bez tekstu marki obok (ekran systemowy bez wordmarku) podaj `label`, wtedy
 * sygnet staje się jedynym nośnikiem nazwy.
 */

/** SSOT ścieżki brand-marku — reużyj, gdy potrzebna sama ścieżka (np. preload). */
export const BRAND_MARK_SRC = LP_ASSETS.seo.logo;

/** Intrinsic wymiary pliku (paletowy PNG 512×512) — dla CLS-safe reservacji. */
const BRAND_MARK_INTRINSIC = 512;

export interface BrandMarkAtomProps {
  /** Klasa sterująca ROZMIAREM (height/width) — rozmiar jest per-miejsce. */
  className?: string;
  /**
   * Dostępna nazwa. Pomiń (dekoracyjny `alt=''`), gdy tekst „Nailfolio" stoi
   * obok. Podaj (np. „Nailfolio"), gdy sygnet jest jedynym nośnikiem marki.
   */
  label?: string;
}

export function BrandMarkAtom({ className, label }: BrandMarkAtomProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 14KB paletowy PNG (SSOT brand-mark); next/image srcset to czysty narzut na 512px sygnecie
    <img
      src={BRAND_MARK_SRC}
      alt={label ?? ''}
      width={BRAND_MARK_INTRINSIC}
      height={BRAND_MARK_INTRINSIC}
      className={className}
      draggable={false}
    />
  );
}
