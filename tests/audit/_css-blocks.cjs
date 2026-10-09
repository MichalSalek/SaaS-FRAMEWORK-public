/**
 * Wspolny parser blokow CSS dla straznikow motywu.
 *
 * PO CO: kilka straznikow liczylo klamry PER LINIA (`opens > closes` otwiera,
 * `closes > opens` zamyka). Blok zapisany w JEDNEJ linii ma `opens === closes`,
 * wiec nie trafial ani na stos, ani do ciala zadnego bloku — byl dla straznika
 * CALKOWICIE NIEWIDZIALNY, choc ten sam kod rozbity na linie failowal. Klasa
 * dawala falszywa zielen w `disabled-text-contrast` i `no-split-bg` oraz
 * falszywa CZERWIEN w `section-discipline` (dozwolony slot `.page`/`.hero` nie
 * mial jak sie dopasowac, bo selektor nigdy nie trafial na stos).
 *
 * `edge-stripe-discipline` domknal to u siebie parserem znakowym; ten plik jest
 * tym samym parserem wyniesionym do JEDNEGO zrodla, zeby czwarta kopia nie
 * zaczela dryfowac — dokladnie ta lekcja, ktora ta sesja przerabiala przy
 * liscie straznikow drzewa.
 *
 * Parser jest swiadomy komentarzy i ciagow: klamra w `content: '}'` nie zamyka
 * reguly, a `/* ... *\/` nie wnosi struktury.
 *
 * Zwraca bloki jako `{ head, body, start, ancestors }`, gdzie `start` to numer
 * linii otwierajacej klamry, a `ancestors` to stos blokow nadrzednych (media,
 * zagniezdzenia) w kolejnosci od zewnatrz.
 */
function parseBlocks(text) {
  const blocks = [];
  const stack = [];
  const n = text.length;
  let i = 0;
  let headStart = 0;
  // Numery linii z PREKOMPUTOWANEJ tablicy offsetow + wyszukiwanie binarne.
  // Wersja skanujaca tekst od zera dla KAZDEJ klamry byla kwadratowa i na
  // duzych arkuszach kosztowala wiecej niz caly skan.
  const lineStarts = [];
  for (let k = 0; k < n; k++) if (text[k] === '\n') lineStarts.push(k);
  const lineOf = idx => {
    let lo = 0;
    let hi = lineStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] < idx) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{') {
      stack.push({
        head: text.slice(headStart, i),
        start: lineOf(i),
        bodyStart: i + 1,
      });
      headStart = i + 1;
      i++;
      continue;
    }
    if (c === '}') {
      const b = stack.pop();
      if (b) {
        b.body = text.slice(b.bodyStart, i);
        b.ancestors = stack.slice();
        blocks.push(b);
      }
      headStart = i + 1;
      i++;
      continue;
    }
    if (c === ';' && stack.length === 0) headStart = i + 1;
    i++;
  }
  return blocks;
}

/**
 * Naglowek bloku BEZ komentarzy. `head` to surowy wycinek od konca poprzedniej
 * deklaracji do klamry, wiec wciaga stojace nad regula komentarze — a te bywaja
 * dlugimi ramkami sekcji i psuja kazde dopasowanie selektora.
 */
function selectorOf(block) {
  return String(block.head || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
}

module.exports = { parseBlocks, selectorOf };
