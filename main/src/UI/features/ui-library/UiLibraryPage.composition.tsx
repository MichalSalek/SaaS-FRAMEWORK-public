import { UI_LIBRARY_GROUPS } from './uiLibrary.registry';
import { LibraryDisclosureComposition } from './UiLibraryEntry.composition';
import { UiLibrarySectionAtomsOrganism } from './UiLibrarySections.atoms.organism';
import { UiLibrarySectionMoleculesOrganism } from './UiLibrarySections.molecules.organism';
import { UiLibrarySectionLpOrganism } from './UiLibrarySections.lp.organism';
import { UiLibrarySectionCompositionsOrganism } from './UiLibrarySections.compositions.organism';
import {
  UiLibrarySectionAppOrganism,
  UiLibrarySectionUtilityOrganism,
} from './UiLibrarySections.app.organism';
import { UiLibrarySectionLabelFamilyOrganism } from './UiLibrarySections.labels.organism';
import styles from './UiLibraryPage.module.css';

/**
 * /ui — living catalog of shared components (dev-only).
 * Scroll and look: each entry is a name, a status pill and a live demo.
 * Implementation notes sit in borderless disclosures. Floor 7xZERO + tokens.
 */
export function UiLibraryPageComposition() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Biblioteka UI</h1>
        <p className={styles.subtitle}>
          Katalog komponentów współdzielonych projektu (dev-only). Żywe rendery
          importują realne komponenty, więc każdy przykład jest jednocześnie
          dowodem, że API działa.
        </p>
      </header>

      <section className={styles.rules} aria-label='Zasady biblioteki'>
        <LibraryDisclosureComposition
          id='library-rules'
          summary='Zasady biblioteki'>
          <ul className={styles.rulesList}>
            <li>
              <strong>FROZEN</strong> = komponent klepnięty (głos ownera w sesji
              /ui lub DECISION w kodzie). Zmiany wizualne TYLKO przez sesję /ui
              z głosem ownera; zmiany czysto techniczne (typy, a11y, refactor
              bez zmiany pikseli) są OK.
            </li>
            <li>
              Strony <strong>używają komponentu, nie kopiują CSS</strong>. Nowa
              sekcja wygląda jak któryś wpis stąd? Importuj komponent i rozszerz
              przez className, zamiast budować per-page klasy od zera.
            </li>
            <li>
              <strong>DRAFT</strong> = stabilne API i realne użycia, ale wizual
              może się jeszcze zmienić bez głosowania.
            </li>
            <li>
              Egzekwowalne wartości (radius enum, tokeny kolorów, type-scale,
              kontener LP) → <code>DESIGN.md §Style Policy</code> (root repo).
            </li>
          </ul>
        </LibraryDisclosureComposition>
      </section>

      <nav className={styles.toc} aria-label='Spis treści'>
        <h2 className={styles.tocTitle}>Spis treści</h2>
        <div className={styles.tocGroups}>
          {UI_LIBRARY_GROUPS.map(group => (
            <div key={group.id}>
              <p className={styles.tocGroupTitle}>
                <a href={`#${group.id}`}>{group.title}</a>
              </p>
              <ul className={styles.tocList}>
                {group.entries.map(entry => (
                  <li key={entry.id}>
                    <a className={styles.tocLink} href={`#${entry.id}`}>
                      {entry.name}
                    </a>{' '}
                    <span className={styles.tocStatus}>{entry.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <div className={styles.hairline} aria-hidden='true' />

      <UiLibrarySectionAtomsOrganism />
      <UiLibrarySectionMoleculesOrganism />
      <UiLibrarySectionLpOrganism />
      <UiLibrarySectionCompositionsOrganism />
      <UiLibrarySectionAppOrganism />
      <UiLibrarySectionUtilityOrganism />
      <UiLibrarySectionLabelFamilyOrganism />
    </main>
  );
}
