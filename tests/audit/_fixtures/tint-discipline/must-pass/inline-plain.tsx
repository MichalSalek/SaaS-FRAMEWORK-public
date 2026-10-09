// Inline style bez złota i bez kremu — legalne (stagger, zmienne układu).
export function Fixture({ index }: { index: number }) {
  return <div style={{ '--stagger-index': index } as React.CSSProperties} />;
}
