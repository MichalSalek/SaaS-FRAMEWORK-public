/**
 * DECISION: dawny podpis „12 prac · 3 przypięte” zniknął, człony łączy przecinek.
 */
export function NotesOrganism() {
  // Stary tytuł „Galeria · Ania” czytał się jak link.
  const docs = 'https://nailfolio.app/pl/'; // adres · komentarz za literałem z ukośnikami
  return (
    <p data-docs={docs}>
      {/* Separator „·” został usunięty,
          człony · rozdziela CSS. */}
      12 prac, 3 przypięte
    </p>
  );
}
