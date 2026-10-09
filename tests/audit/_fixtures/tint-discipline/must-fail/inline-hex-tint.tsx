// Hex w inline-style omija WSZYSTKO: hex-policy skanuje wyłącznie
// *.module.css, a detektor inline pytał o token `--…`, którego tu nie ma.
// Kolor marki wpisany liczbami jest ucieczką z systemu tokenów.
export function Fixture() {
  return <div style={{ background: 'color-mix(in srgb, #d4a840 15%, transparent)' }} />;
}
