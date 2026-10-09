// Neutralny fallback w inline-style: #666 jako zapasowa wartość zmiennej
// i biel jako tło. Zdjęcie bramki color-mix z testu hexa nie może zamienić
// tych zapisów w naruszenie — hex bez chromy nie jest kolorem marki.
export function Fixture() {
  return (
    <p style={{ color: 'var(--color-text-secondary, #666)', background: '#ffffff' }}>
      neutralnie
    </p>
  );
}
