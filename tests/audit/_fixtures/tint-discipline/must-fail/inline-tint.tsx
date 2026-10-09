// Tint wpisany inline w TSX — skan plików CSS jest na to CAŁKOWICIE ślepy.
// Tak przeżyła złota drabina 8/12/16% cyklowana index % 3 w detalu sesji.
export function Fixture({ index }: { index: number }) {
  return (
    <div
      style={{
        background: `color-mix(in oklch, var(--color-primary) ${8 + index * 4}%, transparent)`,
      }}
    />
  );
}
