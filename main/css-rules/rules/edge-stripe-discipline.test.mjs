// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './edge-stripe-discipline.mjs';
import { lintCss } from '../test-utils.mjs';

const FIXTURES = [
  {
    sample: 'must-fail/brace-in-string.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/brace-in-string.module.css':
        "/* Klamra w ciągu znaków. Parser nieświadomy stringów zamykał regułę już na\n   `content: '}'`, więc `inset`, `width` i `background` lądowały poza ciałem\n   jakiegokolwiek bloku i pasek stawał się niewidzialny. Ta sama klasa, którą\n   tint-discipline domknął fixturem brace-in-string. */\n.decoratedRail::before {\n  content: '}';\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 3px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.decoratedRail::before]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/escape-empty-reason.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/escape-empty-reason.module.css':
        "/* Escape BEZ powodu = wyjątek nie do zweryfikowania w review, czyli dokładnie\n   to, przed czym marker ma chronić. Ten sam kontrakt, co przy tint-allow. */\n/* edge-stripe-allow: */\n.rail::before {\n  content: '';\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 3px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.rail::before]  edge-stripe-allow without a reason'],
  },
  {
    sample: 'must-fail/horizontal-bottom-clamp.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/horizontal-bottom-clamp.module.css':
        "/* Wysokość z clamp() i pasek przy DOLNEJ krawędzi — dokładnie tak były\n   zapisane paski „printed edge\" (clamp(3px, 0.5vw, 5px)), więc obie gałęzie\n   muszą mieć własną próbkę. */\n.statusCard::after {\n  content: '';\n  position: absolute;\n  inset: auto 0 0 0;\n  height: clamp(3px, 0.5vw, 5px);\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.statusCard::after]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/horizontal-height-8.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/horizontal-height-8.module.css':
        "/* Górna granica osi poziomej: 8px jeszcze jest paskiem (tak zapisano band\n   akcentu na karcie maintenance), 9px to już pas nagłówka. */\n.maintenanceCard::before {\n  content: '';\n  position: absolute;\n  top: 0;\n  left: 0;\n  right: 0;\n  height: 8px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.maintenanceCard::before]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/horizontal-inset-three.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/horizontal-inset-three.module.css':
        "/* Skrót TRZYCZŁONOWY (`inset: <top> <inline> <bottom>`) — dokładnie tak był\n   zapisany pasek akcentu na kartach ActivateRolePage i przeżył całą falę\n   motywu jako fałszywa zieleń. */\n.stepCard::before {\n  content: '';\n  position: absolute;\n  inset: 0 var(--sp-2) auto;\n  height: 3px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.stepCard::before]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/horizontal-top-rail.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/horizontal-top-rail.module.css':
        "/* Oś POZIOMA: ta sama figura obrócona o 90°, przyklejona do górnej krawędzi\n   („printed edge\" na kartach login / 404 / 500). */\n.noticeCard::before {\n  content: '';\n  position: absolute;\n  inset: 0 0 auto 0;\n  height: 3px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.noticeCard::before]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/single-line-block.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/single-line-block.module.css':
        "/* Cały blok w JEDNEJ linii. Parser liczący klamry per LINIA miał tu\n   opens == closes, więc blok nie trafiał ani na stos, ani do ciała żadnego\n   bloku — ten sam zapis rozbity na linie failował, a jednolinijkowy\n   przechodził. Fałszywa zieleń nie do zauważenia w review. */\n.oneLineRail::before { content: ''; position: absolute; inset: 0 var(--sp-2) auto; height: 3px; background: var(--color-primary) }\n",
    },
    frags: ['[.oneLineRail::before]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/vertical-hairline-1px.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/vertical-hairline-1px.module.css':
        "/* Dolna granica cienkości: 1px to nadal pasek akcentu, a nie „nic\".\n   Bez tej próbki zawężenie zakresu do [2-6] przechodziło bez śladu. */\n.severityRail::before {\n  content: '';\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 1px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.severityRail::before]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/vertical-left-rail.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/vertical-left-rail.module.css':
        "/* Kanoniczny „tell\" AI-slopu: cienki pas akcentu przyklejony do LEWEJ\n   krawędzi karty. Zapis przez skrót `inset` z `auto` w slocie prawym. */\n.planCard::before {\n  content: '';\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 3px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['[.planCard::before]  one-sided accent stripe'],
  },
  {
    sample: 'must-fail/vertical-right-longhand.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/vertical-right-longhand.module.css':
        "/* Ta sama figura po prawej stronie i zapisana longhandem. `top`/`bottom`\n   z wartością inną niż 0 nadal rozpinają pasek na całą krawędź. */\n.threadRow::after {\n  content: '';\n  position: absolute;\n  right: 0;\n  top: 6px;\n  bottom: 6px;\n  width: 4px;\n  background: var(--color-accent);\n}\n",
    },
    frags: ['[.threadRow::after]  one-sided accent stripe'],
  },
  {
    sample: 'must-pass/escape-in-media-head.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/escape-in-media-head.module.css':
        "/* edge-stripe-allow: krawędź strony w widoku do druku — arkusz print nie ma\n   koloru tła, więc linia cięcia jest jedynym nośnikiem marki na kartce */\n@media print {\n  .printedEdge::after {\n    content: '';\n    position: absolute;\n    inset: auto 0 0 0;\n    height: 4px;\n    background: var(--color-primary);\n  }\n}\n",
    },
    frags: ['one-sided accent stripe', 'edge-stripe-allow without a reason'],
  },
  {
    sample: 'must-pass/escape-with-reason.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/escape-with-reason.module.css':
        "/* edge-stripe-allow: tor postępu formularza wieloetapowego — ten pasek JEST\n   danymi (procent ukończenia), nie dekoracyjnym wyróżnieniem karty */\n.progressTrack::before {\n  content: '';\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 3px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['one-sided accent stripe', 'edge-stripe-allow without a reason'],
  },
  {
    sample: 'must-pass/full-hairline-card.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/full-hairline-card.module.css':
        '/* Kanoniczna naprawa (S30/S31): wyróżnienie niesie ZAMKNIĘTA rama 4-bok\n   w kolorze akcentu plus etykieta. To NIE jest pasek jednostronny i strażnik\n   nie może tego ruszać. */\n.recommendedCard {\n  border: 1px solid var(--color-primary);\n  background: var(--color-bg-main);\n  padding: var(--sp-4);\n}\n',
    },
    frags: ['one-sided accent stripe'],
  },
  {
    sample: 'must-pass/neutral-divider-longhand.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/neutral-divider-longhand.module.css':
        "/* POTWIERDZONA fałszywka: legalny neutralny dzielnik zapisany longhandem\n   (`background-color`) był zgłaszany jako pasek akcentu, bo test neutralności\n   pytał wyłącznie o skrót `background:`. Neutralny dzielnik jednostronny ma\n   status <hr> i zostaje. */\n.listRow::after {\n  content: '';\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 1px;\n  background-color: var(--color-divider);\n}\n",
    },
    frags: ['one-sided accent stripe'],
  },
  {
    sample: 'must-pass/neutral-divider-shorthand.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/neutral-divider-shorthand.module.css':
        "/* Ten sam dzielnik zapisany skrótem — gałąź, która działała od początku,\n   ale też nie miała próbki. */\n.listCol::after {\n  content: '';\n  position: absolute;\n  inset: 0 0 auto 0;\n  height: 1px;\n  background: var(--color-line);\n}\n",
    },
    frags: ['one-sided accent stripe'],
  },
  {
    sample: 'must-pass/tall-band-not-a-stripe.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/tall-band-not-a-stripe.module.css':
        "/* To samo na osi poziomej: 9px to pas nagłówka, nie hairline akcentu. */\n.headerBand::before {\n  content: '';\n  position: absolute;\n  inset: 0 0 auto 0;\n  height: 9px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['one-sided accent stripe'],
  },
  {
    sample: 'must-pass/wide-bar-not-a-stripe.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/wide-bar-not-a-stripe.module.css':
        "/* 8px to już kolumna, nie pasek — granica cienkości musi być zakotwiczona\n   także od góry, inaczej jej rozszerzenie zamieniłoby strażnika w zakaz\n   dowolnego elementu przy krawędzi. */\n.sidebarPanel::before {\n  content: '';\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 8px;\n  background: var(--color-primary);\n}\n",
    },
    frags: ['one-sided accent stripe'],
  },
];

const lint = css =>
  lintCss(rule, { 'src/UI/components/x/x.module.css': css }).findings;
const BAR =
  'content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--color-primary);';

describe('css/edge-stripe-discipline', () => {
  // Every sample of the retired tests/audit/_fixtures/<old-name> (same verdict; the fragments are
  // the old .expect / .expect-not lines in this rule's wording).
  for (const sample of FIXTURES) {
    it(`fixture ${sample.sample}`, () => {
      const { findings } = lintCss(rule, sample.files);
      const text = findings.map(f => f.message).join('\n');
      if (sample.fail) {
        expect(findings.length, sample.sample).toBeGreaterThan(0);
        for (const fragment of sample.frags) {
          expect(text).toContain(fragment);
        }
      } else {
        expect(findings, sample.sample).toEqual([]);
      }
    });
  }

  it('scans the whole src/UI root (components and layouts, not only features)', () => {
    expect(
      lintCss(rule, {
        'src/UI/layouts/AppLayout.module.css': `.rail::before { ${BAR} }`,
      }).findings
    ).toHaveLength(1);
    expect(lint(`.rail::before { ${BAR} }`)).toHaveLength(1);
  });

  it('catches the forms the shell regex missed', () => {
    // a nesting parent (the shell skipped every block holding a nested block)
    expect(lint(`.card { ${BAR} &:hover { color: red; } }`)).toHaveLength(1);
    // a 0px offset in the longhand pin
    expect(
      lint(
        '.r::after { position: absolute; right: 0px; top: 0; bottom: 0; width: 2px; background: var(--color-accent); }'
      )
    ).toHaveLength(1);
    // a 3-value horizontal inset written as the LAST declaration (no semicolon)
    expect(
      lint(
        '.s::before { position: absolute; height: 3px; background: var(--color-primary); inset: 0 var(--sp-2) auto }'
      )
    ).toHaveLength(1);
  });

  it('does not count prose: geometry in comments or strings', () => {
    expect(
      lint(
        '/* inset: 0 auto 0 0; width: 3px; */ .a { background: var(--color-primary); }'
      )
    ).toEqual([]);
    expect(
      lint(
        ".a::before { content: 'inset: 0 auto 0 0; width: 3px'; background: var(--color-primary); }"
      )
    ).toEqual([]);
  });

  it('accepts a neutral divider and a full hairline', () => {
    expect(
      lint(
        '.d::after { position: absolute; inset: 0 auto 0 0; width: 1px; background-color: var(--color-divider); }'
      )
    ).toEqual([]);
    expect(lint('.c { border: 1px solid var(--color-primary); }')).toEqual([]);
  });

  it('fails the presence floor on an empty tree', () => {
    const result = lintCss(
      rule,
      { 'src/UI/a.module.css': '.a { color: red; }' },
      { measured: true }
    );
    expect(result.errors.join()).toContain('floor');
  });
});
