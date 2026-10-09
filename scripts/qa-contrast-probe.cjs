#!/usr/bin/env node
/**
 * qa-contrast-probe — POMIAR kontrastu w żywej przeglądarce, na wszystkich
 * trasach publicznych, w obu trybach.
 *
 * PO CO TO ISTNIEJE (S98):
 *   Kontrast tekstu i pierścienia fokusu to jedyne dwie klasy jakości w tym
 *   repo, których NIE DA SIĘ złapać czytaniem kodu, i obie kosztowały tę sesję
 *   najwięcej. Powód jest strukturalny: kolor jest deklarowany w jednym pliku,
 *   tło pochodzi od PRZODKA z innego pliku, a token bywa przestawiany lokalnie
 *   piętro wyżej. Żaden audyt statyczny nie widzi tej trójki naraz.
 *
 *   Co ten pomiar realnie znalazł, gdy powstawał:
 *     - nagłówek finałowego banda konwersji renderował się BIELĄ NA ZŁOCIE
 *       (1,96:1) na /pricing, /compare i /get-app, bo band ma dwa tony, a
 *       nagłówek brał na sztywno kolor jednego z nich. Wisiało od czerwca;
 *     - pierścień fokusu miał 1,00:1 na KAŻDEJ powierzchni atramentowej
 *       (w trybie jasnym token jest celowo równy --color-ink) i 1,17:1 na
 *       złotym pasie, czyli główne CTA zakupu nie miały wskaźnika fokusu;
 *     - trzecia płaszczyzna negatywu (pas newslettera na fiolecie podanym
 *       surowym oklch za lokalnym aliasem) była niewidzialna dla ratcheta,
 *       bo nie używa żadnego tokenu palety.
 *
 * DZIESIĘĆ PUŁAPEK SAMEGO POMIARU. Pierwsze trzy produkowały FAŁSZYWKI, więc
 * były głośne. Ostatnie trzy UKRYWAŁY defekty, więc były ciche — i to one
 * są tu prawdziwym ostrzeżeniem: zieleń tej sondy znaczy tyle, ile wart
 * jest jej model kompozycji.
 *   1. `<input>` to element PUSTY — sonda dopisana jako jego dziecko zostaje
 *      poza drzewem i raportuje kolor domyślny. Wstawiamy ją jako RODZEŃSTWO.
 *   2. `getComputedStyle` oddaje w tym repo wartości `oklch(...)`, a getter
 *      `fillStyle` zwraca je NIEZMIENIONE (to nie jest sRGB). Konwersja musi
 *      iść przez ODCZYT PIKSELA, nie przez odczyt gettera. Do tego `none`
 *      (brakujący komponent z CSS Color 4) trzeba podmienić na 0, bo canvas
 *      go nie przyjmuje. Bez tego: 226 fałszywek „biały ring na białym tle".
 *   3. Tło przodka bywa PÓŁPRZEZROCZYSTE (np. 6% biała nakładka na karcie).
 *      Trzeba złożyć warstwy aż do pierwszej nieprzezroczystej, a nie brać
 *      pierwszej napotkanej. Bez tego: 39 fałszywek „biały na białym".
 *   4. Alfa dotyczy TAKŻE pierwszego planu, nie tylko tła. Kolor tekstu bywa
 *      zapisany jako `color-mix(…, X N%, transparent)` (61 takich deklaracji
 *      `color:` w tym repo; sama konstrukcja, licząc wszystkie właściwości,
 *      występuje 888 razy), więc trzeba go skomponować z tłem PRZED liczeniem
 *      kontrastu. Bez tego sonda melduje sukces nad tekstem, który realnie
 *      stoi poniżej AA — czyli kłamie w najgorszą stronę.
 *   5. `opacity` to NIE to samo co alfa koloru: działa na cały element i MNOŻY
 *      SIĘ po łańcuchu przodków. Trzeba ją policzyć osobno i wmnożyć w krycie,
 *      inaczej tekst przygaszony przez `opacity` liczy się jako w pełni kryjący
 *      (żywy przypadek: etykiety swatchy w filtrach galerii, 18,88:1 według
 *      sondy wobec 2,61:1 naprawdę). Ta sama klasa kłamstwa co pułapka 4.
 *   6. `opacity` to GRUPA, nie mnożnik tekstu. Element z własnym kryjącym tłem
 *      wewnątrz grupy jest przygaszany RAZEM z tym tłem, więc składanie tekstu
 *      przez krycie, ale nad tłem NIEwyblakłym, zawyża wynik (żywy przypadek:
 *      badge kolejki w railu admina — 4,47:1 wg starego modelu wobec 3,94:1
 *      z odczytu pikseli). Trzeba złożyć osobno wnętrze grupy i osobno to, co
 *      pod nią leży, a dopiero potem wmieszać jedno w drugie.
 *
 *   7. Tło bywa malowane przez RODZEŃSTWO, nie przez przodka: kontrolka
 *      segmentowa ma „pigułkę" jako osobny, absolutnie pozycjonowany element
 *      POD tekstem. Łańcuch przodków jej nie widzi, więc sonda meldowała
 *      1,02:1 tam, gdzie naprawdę jest 8,65:1. `elementsFromPoint` nie pomaga —
 *      pomija elementy z `pointer-events: none`, a takie właśnie są nakładki.
 *   8. Odczyt w TRAKCIE animacji wejścia mierzy stan przejściowy. Stała pauza
 *      nie wystarcza tam, gdzie animacja startuje po odpowiedzi z sieci, więc
 *      czekamy na fakt: zero animacji w biegu (pętle wyłączone z warunku).
 *      Bez tego ta sama trasa daje inne wyniki w kolejnych przebiegach.
 *
 *   9. Wskaźnik fokusu nie zawsze jest `outline` NA elemencie: bywa na
 *      kontenerze (`:focus-within` — nagie pole w ozdobnej ramce celowo zdejmuje
 *      własny ring), bywa zmianą ramki, bywa `box-shadow`. Do tego odczyt tuż po
 *      `focus()` łapie przejście CSS w połowie i oddaje jeszcze STARY kolor, więc
 *      kontrolka z `transition: border-color` wygląda na pozbawioną wskaźnika.
 *      Programowe `focus()` po kliknięciu myszą przestaje też pasować do
 *      `:focus-visible` (Chromium przełącza modalność) — bez `focusVisible: true`
 *      warstwy modalne miały niemal zerowe pokrycie fokusu przy zielonym wyniku
 *      (zmierzone: 49 → 1 element z pierścieniem na overlayu filtrów).
 *
 *  10. `fillStyle` IGNORUJE przypisanie, którego nie umie sparsować — zostaje
 *      przy poprzedniej wartości. Wersja z jednym zasiewem `#000000` oddawała
 *      więc KRYJĄCĄ CZERŃ dla każdego wejścia, którego canvas nie zna: skrótu
 *      `borderColor` z różnymi bokami albo gołego tokenu `oklab` wyciętego
 *      z `box-shadow`. Czerń na papierze to ~21:1, czyli cicha zieleń bez
 *      pomiaru. Dwa różne zasiewy rozstrzygają, czy przypisanie doszło.
 *
 * ZNANE ŚLEPE PLAMY (nie „nie ma", tylko „ta sonda tego nie widzi"):
 *   · tło malowane przez PSEUDOELEMENT (`::before`/`::after`) — obchód warstw
 *     czyta `backgroundColor` elementów, więc tint na `::before` liczy się jak
 *     jego brak. Kosztowało to JEDNO trafienie: aktywną etykietę dolnej
 *     nawigacji, gdzie sonda liczyła 4,91:1 nad realnym 4,48:1.
 *   · TEKST malowany przez pseudoelement — `content:` nie jest węzłem tekstowym,
 *     a pętla wymaga własnego węzła, więc taki napis nie jest liczony ani razu.
 *     Żywy przypadek: znak wodny planu FREE nad zdjęciem użytkownika
 *     (`GalleryPhotoCard.module.css`, biel 85% na przyciemnieniu 40% — nad
 *     jasnym zdjęciem schodzi w okolice 2,5:1). Dev-seed nie ma galerii na FREE,
 *     więc nie dosięga tego ani ta sonda, ani odczyt pikseli.
 *   · stany istniejące dopiero po INTERAKCJI innej niż wpisy w `OPENERS`:
 *     wybrany chip, pasek akcji masowych, przycisk „Wyczyść" widoczny wyłącznie
 *     przy aktywnych filtrach. Tu też trzeba pomiaru z ręki. (Uwaga: te akurat
 *     powierzchnie sonda liczy POPRAWNIE, gdy już do nich dotrze — problemem
 *     jest dotarcie, nie model.)
 *   Obie plamy zamyka ten sam sposób: zrzut i odczyt REALNEGO piksela wokół
 *   glifu, zamiast rekonstruowania tła z modelu CSS. Jest wolniejszy, więc nie
 *   jest tu domyślny — ale to on ma rację, gdy oba pomiary się nie zgadzają.
 *
 * ZASIĘG: stan domyślny każdej trasy PLUS warstwy modalne wymienione w
 *   `OPENERS`. Warstwa, której tam nie ma, NIE jest zmierzona — a to właśnie
 *   w takiej ukrył się jeden z findingów tej sesji. Dokładając dialog albo
 *   szufladę, dopisz ją do `OPENERS`, nie zakładaj, że stan domyślny wystarcza.
 *   To samo dotyczy TRAS: panel admina (18 ekranów) przez całą sesję S98 nie
 *   był tu wpisany, więc badge z punktu 6 przeżył dedykowany pomiar kontrastu.
 *   Guard `screens === 0` łapie przebieg, który padł — nie łapie ekranu,
 *   o który nikt nie poprosił.
 *
 * PRÓG: WCAG AA. Tekst 4,5:1, duży tekst (>=24px albo >=18,66px+bold) 3:1,
 *   pierścień fokusu 3:1 (SC 1.4.11, element nietekstowy).
 *
 * UŻYCIE:
 *   BASE_URL=https://dev.example.com node scripts/qa-contrast-probe.cjs
 *   node scripts/qa-contrast-probe.cjs --text     (sam tekst)
 *   node scripts/qa-contrast-probe.cjs --focus    (sam pierścień fokusu)
 *
 * EXIT: 0 gdy zero trafień, 1 gdy cokolwiek poniżej progu ALBO gdy nie udało
 *   się zbadać ani jednego ekranu (sukces nad zerem nie istnieje).
 */
const path = require('path');

const BASE = process.env.BASE_URL || 'https://dev.example.com';
if (!process.env.BASE_URL) {
  console.warn(
    '  [UWAGA] BASE_URL nie ustawiony — celuję w ' + BASE + '.\n' +
    '          QA robimy przez DOMENĘ, nie przez localhost: na innym originie\n' +
    '          błędy konsoli są mylące (origin-block HMR).'
  );
}

const BACKEND = process.env.BACKEND_URL || 'https://api.dev.example.com';
// THEME=<slug> mierzy kandydata palety z /dev/playground: trasa dostaje `?t=<slug>`,
// ktory nadpisanie dev (ThemeQueryOverride.composition, tylko za ARE_DEV_ROUTES_ENABLED)
// maluje na <html> bez zapisu do storage. Bez THEME sonda mierzy produkcyjna palete.
const THEME_QS = process.env.THEME ? `?t=${encodeURIComponent(process.env.THEME)}` : '';

const ROUTES = [
  '/', '/pricing', '/for-stylists', '/for-studios', '/for-clients', '/about',
  '/compare', '/get-app', '/help-center', '/contact', '/user/login', '/welcome',
  '/terms', '/privacy', '/cookies',
];

// Warstwy MODALNE. Pomiar stanu domyslnego trasy nie widzi dialogow, overlayow
// ani szuflad, czyli warstw, w ktorych zyje najwiecej stanow — i wlasnie tam
// schowal sie jeden z findingow tej sesji (chipy filtrow galerii pojawiaja sie
// w DOM dopiero po klikniecu). Kazdy wpis to selektor, ktory ma zostac klikniety
// przed pomiarem; przebieg z otwarta warstwa jest LICZONY OSOBNO od domyslnego.
const OPENERS = {
  '/app/gallery': ['[aria-label="Otwórz filtry"]'],
  // Dialog szczegolow uzytkownika: cztery deklaracje koloru, ktorych zaden
  // przebieg po TRASACH nie widzi, bo warstwa istnieje tylko po klikniecu.
  '/app/admin/users': ['[aria-label^="Szczegóły użytkownika"]'],
  // Skaner QR zyje TYLKO w widoku klientki, wiec klucz jest zawezony do persony
  // (`persona trasa` ma pierwszenstwo przed samym `trasa`). Bez tego przebieg
  // stylistki po /app/pairing raportowalby „NIE ZBADANE" dla przycisku, ktorego
  // w jej widoku z definicji nie ma — czyli szum udajacy brak pokrycia.
  'clientdemo /app/pairing': ['button:has-text("Skanuj kod")'],
};

// Trasy SZCZEGOLU zyja pod dynamicznym id, wiec nie da sie ich wpisac na sztywno
// — a to wlasnie tam siedzi najwiecej stanu produktu. Zamiast pomijac je w ciszy
// (albo wklejac id z lokalnej bazy, ktore zdechnie przy nastepnym seedzie),
// wyciagamy PIERWSZY pasujacy odnosnik ze strony-listy. Gdy lista jest pusta,
// trasa raportuje sie jako NIEZBADANA, nie jako brak defektow.
// Wpis: [persona, trasa-listy, selektor pierwszej pozycji, wzorzec trasy celu].
// KLIKAMY, a nie czytamy `href`: listy w tym repo nawiguja przez `router.push`
// na `role="button"`, wiec szukanie odnosnika znajdowalo zero i cicho zsuwalo
// cala trase szczegolu do „niezbadane".
const DERIVED_ROUTES = [
  ['admin', '/app/admin/support', '[role="button"][tabindex="0"]', /^\/app\/admin\/support\/[^/]+$/],
];

// Trasy ZA LOGOWANIEM. Bez nich sonda ma slepa plame dokladnie tam, gdzie ta
// klasa realnie zyje: trzy z czterech wystapien „bialy tekst na zlotym
// wypelnieniu" (badge szuflady, badge listy wiadomosci, przycisk telefonu)
// siedza w aplikacji i zaden przebieg po stronach publicznych ich nie widzial.
const APP_ROUTES = [
  ['stylistpro', '/app'],
  ['stylistpro', '/app/gallery'],
  ['stylistpro', '/app/sessions'],
  ['stylistpro', '/app/messages'],
  ['stylistpro', '/app/pairing'],
  ['stylistpro', '/app/clients'],
  ['stylistpro', '/app/user/account'],
  ['stylistpro', '/app/user/account/pay'],
  ['stylistpro', '/app/user/support'],
  ['clientdemo', '/app'],
  ['clientdemo', '/app/explore'],
  // Trasy dolozone 2026-09-09: sonda nie widziala ZADNEJ z powierzchni, ktore
  // powstaly w poprzedniej sesji (web-home, zarzadzanie wizytowka, skaner
  // klientki), wiec raportowala nad nimi cisze — dokladnie ten wzorzec „cichego
  // zielonego", przed ktorym ostrzega glowka tego pliku.
  ['stylistpro', '/app/home'],
  ['clientdemo', '/app/home'],
  ['stylistpro', '/app/profile'],
  ['clientdemo', '/app/pairing'],
  // Panel admina to 18 ekranow, ktorych ta sonda nie ogladala wcale — i wlasnie
  // dlatego przezyl w nim badge kolejki na 3,94:1 w trybie jasnym, mimo ze cala
  // sesja miala dedykowany pomiar kontrastu. Glowka tego pliku stawia zasade
  // „sukces nad niezbadanym ekranem nie istnieje"; guard `screens === 0` lapal
  // padniete przebiegi, ale nie lapal ekranow, o ktore nikt nie poprosil.
  ['admin', '/app/admin'],
  ['admin', '/app/admin/users'],
  ['admin', '/app/admin/logs'],
  ['admin', '/app/admin/notes'],
  ['admin', '/app/admin/policies'],
  ['admin', '/app/admin/permissions'],
  ['admin', '/app/admin/colors-traits'],
  ['admin', '/app/admin/feature-flags'],
  ['admin', '/app/admin/health'],
  ['admin', '/app/admin/audit'],
  ['admin', '/app/admin/announcements'],
  ['admin', '/app/admin/reports'],
  ['admin', '/app/admin/config'],
  ['admin', '/app/admin/email-schedule'],
  ['admin', '/app/admin/email-preview'],
  ['admin', '/app/admin/ai-crawlers'],
  ['admin', '/app/admin/moderation'],
  ['admin', '/app/admin/support'],
];

// SSOT kont testowych: .shared-kernel/config/test-users.config.ts. Literalna
// kopia, ten sam kompromis co w qa-theme-probe.cjs (skrypt nie importuje TS).
const AUTH_EMAILS = {
  stylistpro: 'demo-stylist-main@example.com',
  clientdemo: 'demo-client-main@example.com',
  admin: 'test-admin-main@example.com',
};

async function fetchDevLoginToken(email) {
  const headers = { 'content-type': 'application/json', Origin: BASE };
  if (process.env.INTERNAL_SHARED_SECRET) {
    headers['x-internal-secret'] = process.env.INTERNAL_SHARED_SECRET;
  }
  const res = await fetch(`${BACKEND}/api/auth/dev-login`, {
    method: 'POST', headers, body: JSON.stringify({ email }),
  });
  const body = await res.text();
  if (body.includes('DEV_LOGIN_BLOCKED')) {
    throw new Error('DEV_LOGIN_BLOCKED — backend bez NODE_ENV_MANUAL=DEVELOPMENT albo zly sekret');
  }
  const token = res.headers.get('authorization');
  if (!token) throw new Error(`dev-login bez naglowka authorization (HTTP ${res.status})`);
  return token;
}

// Odczyt w TRAKCIE animacji wejscia klamie: element ma wtedy posrednie krycie
// i sonda melduje kontrast, ktorego uzytkownik nigdy nie zobaczy. Stale 1800 ms
// nie wystarcza tam, gdzie animacja startuje dopiero po odpowiedzi z sieci
// (kafelki KPI, lista bledow) — stad trafienia, ktorych drugi przebieg juz nie
// powtarzal. Czekamy wiec na FAKT: zero animacji w biegu. Animacje w petli
// (spinnery) nigdy nie koncza sie same, wiec sa wylaczone z warunku.
async function settle(page, capMs = 6000) {
  try {
    await page.waitForFunction(() => {
      const running = document.getAnimations().filter(a => {
        if (a.playState !== 'running') return false;
        const it = a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : 1;
        return it !== Infinity;
      });
      return running.length === 0;
    }, null, { timeout: capMs });
  } catch {
    // Limit czasu nie jest bledem pomiaru — to informacja, ze strona nie
    // przestaje sie animowac. Mierzymy mimo to, zeby nie zgubic ekranu.
  }
}

const args = process.argv.slice(2);
// Parsowanie AFIRMATYWNE, nie wykluczajace. Poprzednia wersja liczyla flagi
// przez negacje drugiej, wiec podanie OBU — najbardziej naturalny zapis „zmierz
// jedno i drugie" — wylaczalo OBIE klasy i konczylo przebieg zielono nad zerem
// sprawdzonych rzeczy. Brak flag znaczy komplet; flaga WLACZA swoja klase.
const asked = { text: args.includes('--text'), focus: args.includes('--focus') };
const wantText = asked.text || !asked.focus;
const wantFocus = asked.focus || !asked.text;

const PROBE = () => {
  const el = document.createElement('canvas');
  el.width = el.height = 1;
  const cx = el.getContext('2d', { willReadFrequently: true });

  // Konwersja przez ODCZYT PIKSELA (patrz pułapka 2 w główce pliku).
  const toRGBA = v => {
    const s = String(v).trim();
    if (!s || s === 'transparent') return null;
    const val = s.replace(/\bnone\b/g, '0');
    // PULAPKA 10: `fillStyle` IGNORUJE przypisanie, ktorego nie umie sparsowac —
    // zostaje przy poprzedniej wartosci. Wersja z jednym zasiewem `#000000`
    // oddawala wiec KRYJACA CZERN dla kazdego wejscia, ktorego canvas nie zna:
    // wielowartościowego skrotu `borderColor` (806 elementow w lancuchach fokusu)
    // albo golego tokenu `oklab` wycietego z `box-shadow`. Czern na papierze to
    // ~21:1, czyli cicha ZIELEN bez pomiaru. Dwa rozne zasiewy rozstrzygaja, czy
    // przypisanie w ogole doszlo: jesli wartosc zostala odrzucona, wynik idzie za
    // zasiewem i obie proby sie roznia.
    cx.fillStyle = '#000000'; cx.fillStyle = val; const probeBlack = cx.fillStyle;
    cx.fillStyle = '#ffffff'; cx.fillStyle = val; const probeWhite = cx.fillStyle;
    if (probeBlack !== probeWhite) return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return d[3] === 0 ? null : [d[0], d[1], d[2], d[3] / 255];
  };
  const L = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const cr = (a, b) => { const [x, y] = [L(a) + 0.05, L(b) + 0.05]; return x > y ? x / y : y / x; };

  // Zbiera warstwy tla od `from` w gore, do pierwszej nieprzezroczystej
  // (pulapka 3). `stopAfter` pozwala urwac zbieranie na konkretnym przodku —
  // dzieki temu da sie ODDZIELIC tlo lezace WEWNATRZ grupy krycia od tla spoza
  // niej, co jest cala trescia pulapki 6.
  const collectLayers = (from, stopAfter, stopBefore) => {
    const layers = [];
    let a = from;
    while (a) {
      // `stopBefore` urywa zbieranie PRZED tlem danego przodka. Potrzebne przy
      // podkladzie rodzenstwa (pulapka 7): nakladka lezy MIEDZY tlem kontenera
      // a elementem, wiec doliczenie tla kontenera zakryloby ja z powrotem —
      // pierwsza wersja tej poprawki robila dokladnie to i nic nie zmieniala.
      if (a === stopBefore) break;
      const c = toRGBA(getComputedStyle(a).backgroundColor);
      if (c) { layers.push(c); if (c[3] >= 0.999) return { layers, opaque: true }; }
      if (a === stopAfter) break;
      a = a.parentElement;
    }
    return { layers, opaque: false };
  };
  const flatten = (layers, base) => {
    let out = base.slice(0, 3);
    for (let i = layers.length - 1; i >= 0; i--) {
      const [r, g, b, al] = layers[i];
      out = [0, 1, 2].map(k => Math.round([r, g, b][k] * al + out[k] * (1 - al)));
    }
    return out;
  };
  // PULAPKA 7: tlo bywa malowane przez RODZENSTWO, nie przez przodka. Kontrolka
  // segmentowa (zakladki admina) ma zlota "pigulke" jako osobny, absolutnie
  // pozycjonowany element POD tekstem — dla lancucha przodkow niewidzialna, bo
  // to nie przodek. Sonda liczyla wtedy tekst na tle KONTENERA i meldowala
  // 1,02:1 tam, gdzie naprawde jest 8,65:1. `elementsFromPoint` tego nie zalatwia:
  // pomija elementy z `pointer-events: none`, a takie wlasnie sa nakladki.
  const underlay = n => {
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let hit = null;
    for (const scope of [n.parentElement, n.parentElement && n.parentElement.parentElement]) {
      if (!scope) continue;
      for (const sib of scope.children) {
        if (sib === n || sib.contains(n)) continue;
        const cs = getComputedStyle(sib);
        if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const c = toRGBA(cs.backgroundColor);
        if (!c || c[3] < 0.999) continue;
        const b = sib.getBoundingClientRect();
        if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) continue;
        hit = { color: c.slice(0, 3), scope };
      }
    }
    return hit;
  };
  const backdrop = n => {
    const u = underlay(n);
    return u
      ? flatten(collectLayers(n, null, u.scope).layers, u.color)
      : flatten(collectLayers(n, null).layers, [255, 255, 255]);
  };
  const mix = (top, bottom, o) =>
    [0, 1, 2].map(k => Math.round(top[k] * o + bottom[k] * (1 - o)));

  // Najdalszy przodek (wlacznie z samym elementem) z `opacity` ponizej 1 —
  // granica grupy krycia. Wszystko od elementu do niej wlacznie renderuje sie
  // do jednego bufora i dopiero ten bufor jest przygaszany.
  const groupTop = n => {
    let top = null, a = n;
    while (a && a !== document.documentElement) {
      const v = parseFloat(getComputedStyle(a).opacity);
      if (!Number.isNaN(v) && v < 0.999) top = a;
      a = a.parentElement;
    }
    return top;
  };
  // `opacity` mnozy sie po lancuchu przodkow i dziala na CALY element, wiec
  // jest czyms innym niz alfa koloru. Bez tego sonda liczy tekst z
  // `opacity: 0.4` jako w pelni kryjacy — czyli klamie w NAJGORSZA strone,
  // dokladnie tak jak przed domknieciem alfy pierwszego planu. Zywy przypadek:
  // przygaszone etykiety swatchy w filtrach galerii, 18,88:1 wedlug sondy
  // wobec 2,61:1 naprawde.
  const cumulativeOpacity = n => {
    let o = 1, a = n;
    while (a && a !== document.documentElement) {
      const v = parseFloat(getComputedStyle(a).opacity);
      if (!Number.isNaN(v)) o *= v;
      a = a.parentElement;
    }
    return o;
  };
  const visible = n => {
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    // Skumulowana, NIE wlasna: panel schowany przez `opacity: 0` na PRZODKU
    // ma dzieci z opacity 1, wiec test na wlasnej wartosci ich nie odsiewal
    // i sonda mierzyla niewidoczna warstwe, raportujac 1,00:1 (bo skuteczne
    // krycie zero znaczy „widac samo tlo"). Ten sam prog, inny pomiar.
    return cumulativeOpacity(n) >= 0.15;
  };
  // Element bez klasy (goly `span`) jest w raporcie nie do zlokalizowania,
  // wiec dokladamy najblizszego przodka, ktory JAKAS klase ma.
  const cls = n => (typeof n.className === 'string' && n.className)
    ? '.' + n.className.trim().split(/\s+/)[0].slice(-26) : '';
  const name = n => {
    const own = cls(n);
    if (own) return n.tagName.toLowerCase() + own;
    let a = n.parentElement, hint = '';
    while (a && !hint) { hint = cls(a); a = a.parentElement; }
    return n.tagName.toLowerCase() + (hint ? ` (w ${hint})` : '');
  };

  // WCAG 1.4.3 zwalnia z progu kontrasu tekst, ktory jest czescia NIEAKTYWNEJ
  // kontrolki. To jedyne wylaczenie, ktore ta sonda honoruje, i tylko dla
  // kontrolek REALNIE wylaczonych (`disabled` albo `aria-disabled="true"`),
  // nie dla wygaszonych wylacznie wizualnie — te ostatnie nadal reaguja na
  // klikniecie, wiec zwolnienie by ich nie obejmowalo.
  const inInactiveControl = n => {
    let a = n;
    while (a && a !== document.body) {
      if (a.disabled === true || a.getAttribute?.('aria-disabled') === 'true') return true;
      a = a.parentElement;
    }
    return false;
  };

  // Zwolnienie WCAG 1.4.3 mowi o kontrascie TEKSTU w nieaktywnej kontrolce i nic
  // nie mowi o widocznosci pierscienia fokusu (1.4.11). Roznica jest praktyczna:
  // `aria-disabled` NIE odbiera fokusu, wiec taka kontrolka nadal trafia do
  // kolejnosci tabulacji i jej ring musi byc widoczny; natywne `disabled`
  // wyjmuje ja z tabulacji calkowicie. Dlatego petla fokusu zwalnia WYLACZNIE
  // natywnie wylaczone.
  const isNativelyDisabled = n => {
    let a = n;
    while (a && a !== document.body) {
      if (a.disabled === true) return true;
      a = a.parentElement;
    }
    return false;
  };

  const out = { text: [], focus: [], textChecked: 0, focusChecked: 0, focusUnreachable: 0, textUnparsed: 0 };

  // ── Tekst ────────────────────────────────────────────────────────────────
  for (const n of document.querySelectorAll('body *')) {
    const own = [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim().length > 1);
    if (!own || !visible(n) || inInactiveControl(n)) continue;
    const cs = getComputedStyle(n);
    const fg = toRGBA(cs.color);
    // Odkad `toRGBA` uczciwie oddaje `null` zamiast czerni, brak parsowania jest
    // POMINIETYM elementem, a nie „brakiem koloru". Musi sie liczyc, inaczej
    // zamienilibysmy ciche klamstwo (czern = 21:1) na ciche milczenie.
    if (!fg) { out.textUnparsed++; continue; }
    out.textChecked++;
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    // PULAPKA 4: alfa dotyczy TAKZE pierwszego planu. Pierwsza wersja skladala
    // warstwy tla, ale kolor tekstu brala wprost, odcinajac jego kanal alfa —
    // a w tym repo zyje ponad dwiescie deklaracji `color: color-mix(…, X N%,
    // transparent)`. Skutek byl dokladnie odwrotny do zamierzonego: sonda
    // meldowala „zero znalezisk" nad tekstem, ktory realnie stal ponizej AA
    // (np. biel 40% na atramencie to 3,80:1, a nie 16,99:1).
    // PULAPKA 6: `opacity` to GRUPA, nie mnoznik samego tekstu. Element z
    // wlasnym KRYJACYM tlem wewnatrz grupy jest przygaszany RAZEM z tym tlem,
    // wiec skladanie tekstu przez skumulowane krycie, ale nad tlem NIEwyblaklym,
    // zawyza wynik. Zywy przypadek: badge kolejki w railu admina — 4,47:1
    // wedlug starego modelu, 3,94:1 z odczytu pikseli. Blad zawsze w strone
    // optymistyczna, czyli ta sama klasa klamstwa co pulapki 4 i 5.
    // Model: bufor grupy = tekst nad tlem WEWNETRZNYM; bufor wmieszany w tlo
    // ZEWNETRZNE z waga `o`. Tlem glifu jest wiec wyblakle tlo wewnetrzne.
    const gTop = groupTop(n);
    const o = gTop ? cumulativeOpacity(n) : 1;
    const outBg = gTop ? backdrop(gTop.parentElement || document.body) : backdrop(n);
    // Bez wlasnego tla w grupie tlo wewnetrzne ROWNA SIE zewnetrznemu i cale
    // wyrazenie sprowadza sie do poprzedniego modelu — zmiana dotyka wylacznie
    // przypadku, w ktorym grupa cos maluje.
    const inBg = gTop ? flatten(collectLayers(n, gTop).layers, outBg) : outBg;
    const fgAlpha = fg[3];
    const inFg = fgAlpha >= 0.999 ? fg.slice(0, 3) : mix(fg.slice(0, 3), inBg, fgAlpha);
    const bg = o >= 0.999 ? inBg : mix(inBg, outBg, o);
    const eff = o >= 0.999 ? inFg : mix(inFg, outBg, o);
    const ratio = cr(eff, bg);
    if (ratio < need) {
      out.text.push(`${name(n)} ${ratio.toFixed(2)}:1 (prog ${need}, ${px}px${bold ? '/700' : ''}) "${n.textContent.trim().slice(0, 24)}"`);
    }
  }

  // ── Pierścień fokusu ─────────────────────────────────────────────────────
  // Ring rysuje się z `outline-offset`, czyli NA ZEWNĄTRZ elementu, więc liczy
  // się tło RODZICA. Sonda idzie jako RODZEŃSTWO (pułapka 1).
  // Element jest realnie FOKUSOWANY, a kolor czytany z `outlineColor`. Wersja
  // z sonda-rodzenstwem czytala token z SASIADA, wiec nie widziala remapu
  // ustawionego NA SAMYM elemencie (np. skip-link, ktory podnosi ring u siebie)
  // i raportowala go jako defekt mimo poprawnej naprawy. Focus jest jedynym
  // stanem, w ktorym `outline-color` w ogole ma znaczenie, wiec czytamy to,
  // co uzytkownik naprawde zobaczy.
  const active = document.activeElement;
  for (const n of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
    if (!visible(n) || isNativelyDisabled(n)) continue;
    // Wskaznik fokusu w tym repo przybiera CZTERY postacie i siedzi albo na samym
    // elemencie, albo na jego kontenerze: `outline`, zmiana `border-color`, halo
    // `box-shadow`, a nagie pole w ozdobnej ramce celowo zdejmuje wlasny ring
    // i oddaje go kontenerowi przez `:focus-within` (jest na to DECISION w repo).
    // Poprzednia wersja tego bloku probowala objac to lancuchem `else if` i
    // dwukrotnie produkowala FALSZYWA ZIELEN: galaz cienia kasowala pierscien juz
    // zmierzony ze zmiany ramki, a petla przodkow przerywala na cieniu, zanim
    // zdazyla zmierzyc realna ramke kontenera. Zaslonilo to dwa defekty po 1,96:1
    // i 2,30:1. Dlatego teraz: zbieramy SNAPSHOT lancucha przed fokusem, po fokusie
    // szukamy PIERWSZEJ ZMIANY, ktora da sie zmierzyc, i mierzymy ja — zamiast
    // rozstrzygac, ktora postac wskaznika jest „ta wlasciwa".
    const chain = [n];
    for (let a = n.parentElement, i = 0; a && i < 4; a = a.parentElement, i++) chain.push(a);
    const before = chain.map(el => {
      const cs = getComputedStyle(el);
      // `borderColor` to SKROT: gdy boki roznia sie kolorem, oddaje kilka wartosci
      // naraz, ktorych canvas nie sparsuje. Czytamy jedna krawedz.
      return { border: cs.borderTopColor, shadow: cs.boxShadow };
    });
    let ring = null, ringHost = null;
    try {
      // `focusVisible: true` NIE jest kosmetyka. Po klikniecu otwierajacym warstwe
      // modalna Chromium przelacza modalnosc na WSKAZNIKOWA, wiec programowe
      // `focus()` przestaje pasowac do `:focus-visible`, `outlineWidth` wynosi 0
      // i cala warstwa wypadala z pomiaru po cichu: zmierzone 49 → 1 element
      // z pierscieniem na overlayu filtrow i 62 → 5 w dialogu uzytkownika.
      n.focus({ preventScroll: true, focusVisible: true });
      // Element, ktory NIE przyjal fokusu, nie jest „bez pierscienia" — jest poza
      // zasiegiem klawiatury i mierzenie go nie ma sensu. Tak zachowuje sie cala
      // strona pod otwarta warstwa modalna (bezwladna): 75 ze 101 na overlayu.
      if (document.activeElement !== n) { out.focusUnreachable++; continue; }
      // PULAPKA 9: odczyt NATYCHMIAST po `focus()` lapie przejscie CSS w polowie.
      // Kontrolka sygnalizujaca fokus zmiana ramki z `transition` oddawala wtedy
      // jeszcze STARY kolor. `getAnimations().finish()` przeskakuje przejscia do
      // stanu koncowego synchronicznie (sprawdzone: idempotentne).
      try {
        for (const el of chain) {
          for (const anim of el.getAnimations()) { try { anim.finish(); } catch {} }
        }
      } catch {}
      for (let i = 0; i < chain.length && !ring; i++) {
        const el = chain[i], cs = getComputedStyle(el);
        // `outline` na przodku liczy sie tylko wtedy, gdy przodek go NIE mial
        // przed fokusem — inaczej pozyczylibysmy statyczna ozdobe.
        if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') {
          ring = toRGBA(cs.outlineColor); ringHost = el; break;
        }
        if (cs.borderTopColor !== before[i].border) {
          const c = toRGBA(cs.borderTopColor);
          if (c) { ring = c; ringHost = el; break; }
        }
        if (cs.boxShadow !== before[i].shadow && cs.boxShadow !== 'none') {
          // Halo `box-shadow`: w wartosci WYLICZONEJ kolor stoi na poczatku.
          // Lista funkcji musi obejmowac `oklab()` i `color()` — to dominujaca
          // postac wyliczonego `color-mix` w tym repo. Golego `[a-z]+` tu NIE MA:
          // lapal token `oklab`, ktory canvas odrzuca, a odrzucenie oddawalo czern.
          const lead = cs.boxShadow.match(
            /^(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|hsla?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i
          );
          // `inset` rysuje sie WEWNATRZ, wiec nie jest pierscieniem wokol elementu.
          const c = lead && !/\binset\b/.test(cs.boxShadow) ? toRGBA(lead[1]) : null;
          // Brak dopasowania nie konczy szukania — idziemy dalej lancuchem, zamiast
          // uznac element za pozbawiony wskaznika.
          if (c) { ring = c; ringHost = el; break; }
        }
      }
    } catch { out.focusUnreachable++; continue; }
    // Doszlismy tu tylko wtedy, gdy element PRZYJAL fokus i ZADNA z czterech
    // postaci wskaznika nie pojawila sie ani na nim, ani na czterech przodkach —
    // czyli realnie nie widac, gdzie jest kursor klawiatury. To SC 2.4.7.
    if (!ring) {
      out.focus.push(`${name(n)} BRAK WIDOCZNEGO PIERSCIENIA FOKUSU`);
      continue;
    }
    out.focusChecked++;
    // backdrop od RODZICA, nie od elementu: przy `outline-offset` ring lezy
    // POZA border-boxem, wiec tlem jest to, co za elementem. Czytanie tla
    // samego elementu daje np. „zloty ring na zlotym przycisku" (1,17:1)
    // tam, gdzie ring realnie rysuje sie na ciemnej sekcji.
    // Gdy ring rysuje kontener (`:focus-within`), tlem jest rodzic KONTENERA.
    const ringAnchor = ringHost || n;
    const ratio = cr(ring.slice(0, 3), backdrop(ringAnchor.parentElement || ringAnchor));
    if (ratio < 3) out.focus.push(`${name(n)} ${ratio.toFixed(2)}:1`);
  }
  if (active && active.focus) { try { active.focus({ preventScroll: true }); } catch {} }
  return out;
};

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    ({ chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright')));
  }
  const browser = await chromium.launch();
  let textChecked = 0, focusChecked = 0, focusUnreachable = 0, textUnparsed = 0, screens = 0;
  const findings = [];
  // Powierzchnie, ktorych z jakiegos powodu NIE zmierzono. Musza sie wypisac,
  // inaczej „zero znalezisk" bierze na siebie ekrany, ktorych nikt nie widzial.
  const unmeasured = [];

  // ONLY=/app/admin/health zawezа przebieg do jednej trasy. Pelny sweep trwa
  // ~10 minut, wiec bez tego kazde sprawdzenie POJEDYNCZEJ naprawy kosztuje
  // tyle, co caly audyt — a to jest dokladnie ten koszt, przy ktorym przestaje
  // sie weryfikowac naprawy i zaczyna ufac diffowi. Zawezony przebieg MELDUJE
  // sie w naglowku, zeby nikt nie wzial go za pelny.
  const only = process.env.ONLY ? process.env.ONLY.split(',').map(x => x.trim()).filter(Boolean) : null;

  // Tokeny personas. Pad tokenu NIE jest cichy: trasy tej persony ida do
  // findingow, a nie do milczacego pominiecia. Ale pobieramy je TYLKO dla person,
  // ktorych trasy realnie sa w zawezeniu — inaczej przebieg ograniczony do tras
  // publicznych czerwienil sie z powodu person, ktorych swiadomie nie obejmuje,
  // i przy niedostepnym backendzie NIGDY nie mogl wyjsc zielono. Bramka jest ta
  // sama, ktora dostal juz blok tras pochodnych.
  const personaNeeded = persona =>
    !only ||
    APP_ROUTES.some(([p, r]) => p === persona && only.includes(r)) ||
    DERIVED_ROUTES.some(([p, listRoute]) => p === persona && only.includes(listRoute));
  const tokens = {};
  for (const persona of Object.keys(AUTH_EMAILS)) {
    if (!personaNeeded(persona)) continue;
    try {
      tokens[persona] = await fetchDevLoginToken(AUTH_EMAILS[persona]);
    } catch (e) {
      findings.push(`TOKEN ${persona} — ${e.message.slice(0, 90)}`);
    }
  }
  // Trasy pochodne rozwiazujemy PRZED planem, zeby weszly do niego jak zwykle
  // pozycje (razem z filtrem ONLY i licznikiem ekranow).
  const derived = [];
  for (const [persona, listRoute, rowSelector, pattern] of DERIVED_ROUTES) {
    // Bramka `ONLY` musi objac takze rozwiazywanie tras pochodnych. Bez niej
    // zawezony przebieg probowal wejsc w liste spoza zawezenia, dopisywal ja do
    // niezbadanych i — odkad niezbadane czerwienia — konczyl sie bledem z powodu
    // trasy, ktorej SWIADOMIE nie obejmowal. Przy okazji oszczedza to drill-in.
    if (only && !only.includes(listRoute)) continue;
    if (!tokens[persona]) { derived.push([persona, listRoute, null]); continue; }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate(t => localStorage.setItem('authorization', t), tokens[persona]);
      await page.goto(BASE + listRoute, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1800);
      await page.click(rowSelector, { timeout: 5000 });
      await page.waitForURL(u => pattern.test(new URL(u).pathname), { timeout: 10000 });
      derived.push([persona, new URL(page.url()).pathname, listRoute]);
    } catch (e) {
      derived.push([persona, listRoute, null, e.message.slice(0, 60)]);
    }
    await page.close();
  }
  for (const [, route, from, why] of derived) {
    if (from === null) {
      unmeasured.push(`${route}/[id] — nie udalo sie wejsc w pozycje listy${why ? ` (${why})` : ''}`);
    }
  }

  // Trasa pochodna ma nieprzewidywalny adres, wiec `ONLY` celuje w nia przez
  // trase LISTY, z ktorej powstala — inaczej nie dalaby sie sprawdzic punktowo.
  const plan = [
    ...ROUTES.map(r => [null, r, null]),
    ...APP_ROUTES.map(([p, r]) => [p, r, null]),
    ...derived.filter(d => d[2] !== null).map(d => [d[0], d[1], d[2]]),
  ].filter(([, r, from]) => !only || only.includes(r) || (from && only.includes(from)));
  if (only) {
    console.warn(`  [ZAWEZONY PRZEBIEG] tylko: ${only.join(', ')} — to NIE jest pelny audyt.`);
  }
  // `--text` / `--focus` wyciszaja CALA klase znalezisk. Bez baneru przebieg
  // wyglada jak pelny, a koncowy werdykt zaswiadczal o OBU klasach — czyli
  // zielen nad niezmierzonym, ta sama choroba co sukces nad zerem ekranow.
  if (!wantText || !wantFocus) {
    console.warn(`  [ZAWEZONY PRZEBIEG] mierzony tylko ${wantText ? 'TEKST' : 'PIERSCIEN FOKUSU'} — druga klasa NIE jest sprawdzana.`);
  }
  // Nie do osiagniecia po zmianie parsowania, ale zostaje jako bezpiecznik: gdyby
  // ktos kiedys dolozyl trzecia flage i pomylil logike, przebieg ma sie wywrocic,
  // a nie zameldowac zielen nad zerem klas.
  if (!wantText && !wantFocus) {
    console.error('  Zadna klasa nie jest mierzona — to nie jest przebieg, tylko cisza.');
    process.exit(2);
  }
  if (!plan.length) {
    console.error(`  ONLY=${process.env.ONLY} nie pasuje do zadnej znanej trasy.`);
    process.exit(2);
  }
  // Guard na PUSTY plan lapal tylko przypadek, w ktorym bledne sa WSZYSTKIE
  // pozycje. Literowka w jednej z kilku zawezala przebieg bez sladu, a werdykt
  // reczyl w imieniu trasy, ktorej nikt nie zmierzyl — dziesiata sztuka „zieleni
  // bez pokrycia" w tej fali. Kazda pozycja `ONLY` musi trafic w plan.
  if (only) {
    const inPlan = new Set(plan.flatMap(([, r, from]) => (from ? [r, from] : [r])));
    const orphans = only.filter(o => !inPlan.has(o));
    if (orphans.length) {
      console.error(`  ONLY zawiera trasy, ktorych nie ma w planie: ${orphans.join(', ')}`);
      process.exit(2);
    }
  }

  for (const mode of ['light', 'dark']) {
    for (const [persona, route] of plan) {
      if (persona && !tokens[persona]) {
        findings.push(`${mode} ${route} · NIE ZBADANE: brak tokenu persony ${persona}`);
        continue;
      }
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: mode });
      try {
        if (persona) {
          await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.evaluate(t => localStorage.setItem('authorization', t), tokens[persona]);
        }
        const resp = await page.goto(BASE + route + THEME_QS, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Strona 404 tez renderuje naglowek i tekst, wiec bez sprawdzenia statusu
        // sonda mierzy ja jako normalny ekran i melduje zielen — a trasa, o ktora
        // chodzilo, nie jest mierzona NIGDY. Zywy przypadek: `/app/support` nie
        // istnieje (jest `/app/user/support`) i przechodzil tak przez cala sesje.
        const status = resp ? resp.status() : 0;
        if (status >= 400 || status === 0) {
          findings.push(`${mode} ${route} · NIE ZBADANE: HTTP ${status || 'brak odpowiedzi'} — mierzylibysmy strone bledu`);
          await page.close();
          continue;
        }
        // Animacje wejścia `staggerIn` trzymają stan FROM do upływu delaya —
        // odczyt bez tej pauzy widzi elementy przezroczyste i je pomija.
        await page.waitForTimeout(1800);
        // Przekierowanie znaczy, ze mierzymy INNA strone niz deklarowana. Na devie
        // dzis nie wystepuje, ale `BASE_URL` celujacy w preview/prod odsyla trasy
        // produktu na `/get-app` (`resolveDesktopBounceDecision`) — bez tej bramki
        // raport nazywalby `/get-app` nazwa `/app/gallery`. Sonda siostrzana ma to
        // porownanie od dawna; ta go nie miala.
        const landed = new URL(page.url()).pathname.replace(/\/$/, '') || '/';
        const wanted = route.replace(/\/$/, '') || '/';
        if (landed !== wanted) {
          findings.push(`${mode} ${route} · NIE ZBADANE: przekierowanie na ${landed}`);
          await page.close();
          continue;
        }
        await settle(page);
        const r = await page.evaluate(PROBE);
        // Ekran zmierzony nad ZEREM elementow liczyl sie jako zbadany, nie zostawial
        // sladu w raporcie i konczyl sie zerem. Guard istnial tylko na SUMIE
        // globalnej (`if (!screens)`), wiec jedna pusta trasa posrod pelnych znikala
        // bez echa — a werdykt reczyl za „kazdy tekst". Wyzwalacz jest realny, nie
        // teoretyczny: pusta powloka po nieudanej hydracji (udokumentowany incydent
        // CSP/SSG w tym repo) albo ekran renderujacy sie po uplywie pauzy.
        if (r.textChecked + r.focusChecked === 0) {
          findings.push(`${mode} ${route} · NIE ZBADANE: zero elementow do zmierzenia (pusta powloka?)`);
        }
        screens++;
        textChecked += r.textChecked;
        focusChecked += r.focusChecked;
        focusUnreachable += r.focusUnreachable;
        textUnparsed += r.textUnparsed;
        if (wantText) for (const t of [...new Set(r.text)]) findings.push(`${mode} ${route} · TEKST · ${t}`);
        if (wantFocus) for (const f of [...new Set(r.focus)]) findings.push(`${mode} ${route} · FOKUS · ${f}`);

        for (const opener of OPENERS[`${persona} ${route}`] || OPENERS[route] || []) {
          try {
            await page.click(opener, { timeout: 5000 });
            await page.waitForTimeout(900);
            const m = await page.evaluate(PROBE);
            if (m.textChecked + m.focusChecked === 0) {
              findings.push(`${mode} ${route} (po ${opener}) · NIE ZBADANE: zero elementow do zmierzenia`);
            }
            screens++;
            textChecked += m.textChecked;
            focusChecked += m.focusChecked;
            focusUnreachable += m.focusUnreachable;
            textUnparsed += m.textUnparsed;
            const tag = `${route} (po ${opener})`;
            if (wantText) for (const t of [...new Set(m.text)]) findings.push(`${mode} ${tag} · TEKST · ${t}`);
            if (wantFocus) for (const f of [...new Set(m.focus)]) findings.push(`${mode} ${tag} · FOKUS · ${f}`);
          } catch (e) {
            // Nieotwarta warstwa to NIEZBADANY ekran, nie brak defektu.
            findings.push(`${mode} ${route} · NIE ZBADANE: nie udalo sie otworzyc ${opener} (${e.message.slice(0, 50)})`);
          }
        }
      } catch (e) {
        findings.push(`${mode} ${route} · NIE ZBADANE: ${e.message.slice(0, 70)}`);
      }
      await page.close();
    }
  }
  await browser.close();

  if (unmeasured.length) {
    console.log('\nNIEZBADANE (jawnie, nie po cichu):');
    unmeasured.forEach(u => console.log('  · ' + u));
    // Wypisanie NIE wystarczy. Kazda inna sciezka "nie zmierzono" w tym pliku
    // konczy przebieg czerwono (pad tokenu persony, nieotwarta warstwa, wyjatek
    // nawigacji) — ten kubelek jako jedyny zostawial zielen i exit 0, czyli
    // dokladnie sukces nad niezbadanym ekranem, przeciw ktoremu stoi glowka.
    unmeasured.forEach(u => findings.push(`NIE ZBADANE: ${u}`));
  }
  console.log(`\nZBADANE: ${screens} ekranów · ${textChecked} elementów z tekstem · ${focusChecked} elementów fokusowalnych`);
  console.log(`  (poza zasięgiem klawiatury: ${focusUnreachable} — głównie strona pod otwartą warstwą modalną; każda postać wskaźnika jest mierzona, nie ma kubełka „niemierzone")`);
  if (textUnparsed) findings.push(`NIE ZBADANE: ${textUnparsed} elementów o kolorze, którego nie da się sparsować — pomiar ich pomija`);
  if (!screens) {
    console.log('\n✗ ZERO ZBADANYCH EKRANÓW — sukces nad zerem nie istnieje.');
    process.exit(1);
  }
  if (findings.length) {
    console.log(`\nZNALEZISKA (${findings.length}):`);
    findings.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  const measured = wantText && wantFocus
    ? 'każdy tekst i każdy pierścień fokusu'
    : (wantText ? 'każdy tekst (pierścień fokusu NIEsprawdzany)' : 'każdy pierścień fokusu (tekst NIEsprawdzany)');
  console.log(`\n✓ Zero znalezisk: ${measured} powyżej progu WCAG AA.`);
})();
