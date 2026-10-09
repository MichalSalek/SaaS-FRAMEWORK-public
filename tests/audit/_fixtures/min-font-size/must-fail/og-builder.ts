// Plik .ts BEZ JSX-a: buildery kart OG składają drzewo przez
// React.createElement, więc raw px mieszka w zwykłym module TypeScriptu.
// Rozszerzenie skanu o *.ts nie miało żadnej próbki — jego usunięcie
// przechodziło przez meta-strażnika bezgłośnie.
export const captionStyle = {
  fontSize: 12,
  letterSpacing: '0.02em',
};
