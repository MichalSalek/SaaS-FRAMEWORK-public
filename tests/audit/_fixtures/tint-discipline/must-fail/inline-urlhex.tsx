// Kolor marki zakodowany URL-owo w data-URI, w obiekcie stylu pod stałą.
// Ani „#", ani tokenu, ani color-mix — komplet warunków, przy których
// poprzednia bramka wypuszczała zapis bez śladu.
export function Fixture() {
  const dots = {
    backgroundImage:
      "url(\"data:image/svg+xml;utf8,%3Csvg%3E%3Ccircle r='1' fill='%23d4a840'/%3E%3C/svg%3E\")",
  } as React.CSSProperties;
  return <div style={dots} />;
}
