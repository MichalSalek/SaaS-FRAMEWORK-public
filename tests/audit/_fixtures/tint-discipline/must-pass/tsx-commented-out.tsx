/*
 * Wariant odrzucony w review, zostawiony w komentarzu jako ślad decyzji:
 * style={{ background: 'color-mix(in oklch, var(--color-primary) 12%, transparent)' }}
 */
// Ten sam zapis w komentarzu liniowym:
// style={{ background: 'var(--color-bg-subtle)' }}
export function Fixture() {
  return <div className="plain" />;
}
