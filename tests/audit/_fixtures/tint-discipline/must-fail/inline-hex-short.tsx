// Hex TRZYZNAKOWY i bez color-mix. Dwie gałęzie naraz: rozwijanie skróconego
// zapisu (#d94 -> #dd9944) oraz bramka color-mix, która stała PRZED testem
// hexa i odcinała go w całości.
export function Fixture() {
  return <div style={{ background: '#d94' }} />;
}
