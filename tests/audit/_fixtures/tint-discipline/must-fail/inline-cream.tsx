// Krem wpisany inline: skan modułów go nie widzi, a limit „jeden pas kremu
// na stronę" liczy wyłącznie to, co stoi w CSS. Bramka wymagająca color-mix
// odcinała ten zapis, zanim test kremu zdążył cokolwiek sprawdzić.
export function Fixture() {
  return <div style={{ background: 'var(--color-bg-subtle)' }} />;
}
