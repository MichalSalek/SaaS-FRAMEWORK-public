// @vitest-environment node
import guard from './tint-inline-style.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const error = [{ messageId: 'tint' }];
const sample = code => ({ code, filename: 'src/UI/features/x/X.tsx' });
const GOLD = "'color-mix(in oklch, var(--color-primary) 12%, transparent)'";

tester.run('nf/tint-inline-style', guard.rule, {
  valid: [
    // retired fixtures (tests/audit/_fixtures/tint-discipline, must-pass)
    sample(
      "// Neutralny fallback w inline-style: #666 jako zapasowa wartość zmiennej\n// i biel jako tło. Zdjęcie bramki color-mix z testu hexa nie może zamienić\n// tych zapisów w naruszenie — hex bez chromy nie jest kolorem marki.\nexport function Fixture() {\n  return (\n    <p style={{ color: 'var(--color-text-secondary, #666)', background: '#ffffff' }}>\n      neutralnie\n    </p>\n  );\n}\n"
    ),
    sample(
      "// Inline style bez złota i bez kremu — legalne (stagger, zmienne układu).\nexport function Fixture({ index }: { index: number }) {\n  return <div style={{ '--stagger-index': index } as React.CSSProperties} />;\n}\n"
    ),
    sample(
      "/*\n * Wariant odrzucony w review, zostawiony w komentarzu jako ślad decyzji:\n * style={{ background: 'color-mix(in oklch, var(--color-primary) 12%, transparent)' }}\n */\n// Ten sam zapis w komentarzu liniowym:\n// style={{ background: 'var(--color-bg-subtle)' }}\nexport function Fixture() {\n  return <div className=\"plain\" />;\n}\n"
    ),
    // prose: a tint in a comment inside the style, or a string outside any style attribute
    sample(
      `const a = <div style={{ /* background: ${GOLD} */ color: 'red' }} />;`
    ),
    sample(
      `const a = <div style={{\n  // background: 'var(--color-bg-subtle)'\n  color: 'red',\n}} />;`
    ),
    sample(`const s = ${GOLD};\nconst a = <div title={s} />;`),
    // a value READ inside the object is not a style object (data-viz colours from tokens)
    sample(
      `const C = { PRO: 'color-mix(in oklch, var(--color-primary) 82%, var(--color-text-primary))' };\nconst a = <i style={{ background: C.PRO }} />;`
    ),
    // a full gold colour without mixing is a brand fill, not a wash
    sample("const a = <i style={{ color: 'var(--color-primary)' }} />;"),
  ],
  invalid: [
    // retired fixtures (tests/audit/_fixtures/tint-discipline, must-fail)
    {
      ...sample(
        "// Krem wpisany inline: skan modułów go nie widzi, a limit „jeden pas kremu\n// na stronę\" liczy wyłącznie to, co stoi w CSS. Bramka wymagająca color-mix\n// odcinała ten zapis, zanim test kremu zdążył cokolwiek sprawdzić.\nexport function Fixture() {\n  return <div style={{ background: 'var(--color-bg-subtle)' }} />;\n}\n"
      ),
      errors: error,
    },
    {
      ...sample(
        "// Hex TRZYZNAKOWY i bez color-mix. Dwie gałęzie naraz: rozwijanie skróconego\n// zapisu (#d94 -> #dd9944) oraz bramka color-mix, która stała PRZED testem\n// hexa i odcinała go w całości.\nexport function Fixture() {\n  return <div style={{ background: '#d94' }} />;\n}\n"
      ),
      errors: error,
    },
    {
      ...sample(
        "// Hex w inline-style omija WSZYSTKO: hex-policy skanuje wyłącznie\n// *.module.css, a detektor inline pytał o token `--…`, którego tu nie ma.\n// Kolor marki wpisany liczbami jest ucieczką z systemu tokenów.\nexport function Fixture() {\n  return <div style={{ background: 'color-mix(in srgb, #d4a840 15%, transparent)' }} />;\n}\n"
      ),
      errors: error,
    },
    {
      ...sample(
        '// Obiekt stylu zbudowany POD STAŁĄ i podany jako `style={rowStyle}`.\n// Detektor szukający literału `style={{` widział wyłącznie obiekt wpisany\n// wprost w JSX, więc ten kształt — najczęstszy tam, gdzie styl składa się\n// warunkowo — przechodził bez śladu. Tak przeżył 15-procentowy tint na\n// prymitywie współdzielonym (Chip).\nexport function Fixture({ index }: { index: number }) {\n  const rowStyle = {\n    background: `color-mix(in oklch, var(--color-primary) ${8 + index * 4}%, transparent)`,\n  } as React.CSSProperties;\n  return <div style={rowStyle} />;\n}\n'
      ),
      errors: error,
    },
    {
      ...sample(
        '// Tint wpisany inline w TSX — skan plików CSS jest na to CAŁKOWICIE ślepy.\n// Tak przeżyła złota drabina 8/12/16% cyklowana index % 3 w detalu sesji.\nexport function Fixture({ index }: { index: number }) {\n  return (\n    <div\n      style={{\n        background: `color-mix(in oklch, var(--color-primary) ${8 + index * 4}%, transparent)`,\n      }}\n    />\n  );\n}\n'
      ),
      errors: error,
    },
    {
      ...sample(
        '// Kolor marki zakodowany URL-owo w data-URI, w obiekcie stylu pod stałą.\n// Ani „#", ani tokenu, ani color-mix — komplet warunków, przy których\n// poprzednia bramka wypuszczała zapis bez śladu.\nexport function Fixture() {\n  const dots = {\n    backgroundImage:\n      "url(\\"data:image/svg+xml;utf8,%3Csvg%3E%3Ccircle r=\'1\' fill=\'%23d4a840\'/%3E%3C/svg%3E\\")",\n  } as React.CSSProperties;\n  return <div style={dots} />;\n}\n'
      ),
      errors: error,
    },
    // forms the text scan could not follow: a ternary of style objects, a spread, an alias chain
    {
      ...sample(
        `const base = { background: ${GOLD} };\nconst a = (on) => <div style={on ? base : undefined} />;`
      ),
      errors: error,
    },
    {
      ...sample(
        `const base = { background: 'var(--color-bg-subtle)' };\nconst a = <div style={{ ...base, color: 'red' }} />;`
      ),
      errors: error,
    },
    {
      ...sample(
        `const s1 = { background: '#d4a840' };\nconst s2 = s1;\nconst a = <div style={s2} />;`
      ),
      errors: error,
    },
    // a *Style prop of a component
    {
      ...sample(
        "const a = <Chart contentStyle={{ background: 'rgba(212, 168, 64, 0.12)' }} />;"
      ),
      errors: error,
    },
    // the template literal in the value is read (CSS values live in strings)
    {
      ...sample(
        'const a = (n) => <div style={{ background: `color-mix(in oklch, var(--color-accent) ${n}%, white)` }} />;'
      ),
      errors: error,
    },
  ],
});
