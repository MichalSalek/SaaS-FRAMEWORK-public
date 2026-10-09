// Obiekt stylu zbudowany POD STAŁĄ i podany jako `style={rowStyle}`.
// Detektor szukający literału `style={{` widział wyłącznie obiekt wpisany
// wprost w JSX, więc ten kształt — najczęstszy tam, gdzie styl składa się
// warunkowo — przechodził bez śladu. Tak przeżył 15-procentowy tint na
// prymitywie współdzielonym (Chip).
export function Fixture({ index }: { index: number }) {
  const rowStyle = {
    background: `color-mix(in oklch, var(--color-primary) ${8 + index * 4}%, transparent)`,
  } as React.CSSProperties;
  return <div style={rowStyle} />;
}
