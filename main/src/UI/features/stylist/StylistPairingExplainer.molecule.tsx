import { useTranslations } from 'next-intl';
import { CheckCircleIcon, QrCodeIcon } from '@phosphor-icons/react';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './StylistProfilePage.module.css';

// Ikona stoi w uchwycie o wysokości JEDNEJ linii tekstu (`lineIcon`, 1lh),
// więc przy zawiniętej pozycji (niemiecki na 360 px) zostaje na pierwszej
// linii zamiast środkować się względem całego akapitu.
function ValueCheck() {
  return (
    <span className={styles.lineIcon} aria-hidden='true'>
      <CheckCircleIcon size={18} />
    </span>
  );
}

/**
 * „Co zyskujesz po połączeniu" + wskazówka o dwóch drogach połączenia.
 * Wydzielone z StylistProfileActions (max-lines); logika widoczności bez zmian.
 */
export function StylistPairingExplainerMolecule({
  isPaired,
  isPendingRequest,
  canRequestPair,
}: {
  isPaired: boolean;
  isPendingRequest: boolean;
  canRequestPair: boolean;
}) {
  const tExplainer = useTranslations('stylist.pairingExplainer');

  return (
    <>
      {!isPaired && (
        // DECISION (nie usuwaj tego komentarza):
        // Forward-looking value list ("co zyskujesz po sparowaniu"), NIE
        // before/after BYŁO→JEST (floor §7). Stan "przed" = ta sama strona, więc
        // kolumna oppozycyjna z czerwonymi X nic nie wnosi — pokazujemy tylko
        // zyski (zielone check) jako jedną listę. Tytuł = h2 (sekcja top-level
        // pod profilowym h1; gallery title też h2 — porządek nagłówków).
        // i18n: używane title + afterItems.* (dawne beforeItems/afterLabel/
        // beforeLabel już usunięte z JSON).
        <section className={styles.pairingExplainer}>
          <TypographyAtom variant='h2' className={styles.pairingExplainerTitle}>
            {tExplainer('title')}
          </TypographyAtom>
          <ul className={styles.valueList}>
            <li>
              <ValueCheck />
              <span>{tExplainer('afterItems.fullGallery')}</span>
            </li>
            <li>
              <ValueCheck />
              <span>{tExplainer('afterItems.sessions')}</span>
            </li>
            <li>
              <ValueCheck />
              <span>{tExplainer('afterItems.notes')}</span>
            </li>
            <li>
              <ValueCheck />
              <span>{tExplainer('afterItems.history')}</span>
            </li>
          </ul>
        </section>
      )}

      {/* Tip o dwóch drogach połączenia tylko dla NIEpołączonych bez
        czekającej prośby, którzy MOGĄ prosić (gość/klientka) — połączona
        klientka i PENDING dostawały instrukcję sprzeczną ze stanem, a
        stylistka-widz (canRequestPair=false) instrukcję „wyślij prośbę"
        bez przycisku prośby (review S51 + Codex). */}
      {!isPaired && !isPendingRequest && canRequestPair && (
        <section className={styles.pairingCta}>
          <span className={styles.pairingCtaIcon} aria-hidden='true'>
            <QrCodeIcon size={20} />
          </span>
          <div className={styles.pairingCtaText}>
            <TypographyAtom variant='body2'>
              {tExplainer('ctaBody')}
            </TypographyAtom>
            <TypographyAtom variant='caption'>
              {tExplainer('ctaCaption')}
            </TypographyAtom>
          </div>
        </section>
      )}
    </>
  );
}
