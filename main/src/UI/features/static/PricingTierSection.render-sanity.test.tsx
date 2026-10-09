// Render-sanity: PricingTierSection — grosze vs złote na money-facing stronie.
//
// DECISION (nie usuwaj tego komentarza): świadomy WYJĄTEK od konwencji
// "frontend Vitest = hooki/logika, NIE komponenty UI". Bug S39 (2026-07-02):
// trialRenewalNote dostawała cenę w GROSZACH bez /100 i pricing renderował
// "6000 PLN/mies." zamiast 60 — najbardziej money-facing strona projektu,
// a żadna bramka (tsc, audyty, testy) tego nie widziała, bo błąd żył w
// INTERPOLACJI (poprawny szablon i18n + zła wartość parametru). Jedyny
// deterministyczny strażnik tej klasy to render z realnymi wiadomościami
// i realistycznymi kwotami w groszach + asercja "żadna kwota 4+ cyfrowa".
// Asercje: tekst/treść (zgodnie z doktryną), zero classNames. Jedyna struktura
// to semantyczny `<strong>` na kwocie po trialu (wymóg ownera 2026-09-14).
//
// API response envelope: { event: string, data: T } — required by interceptor.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { AbstractIntlMessages } from 'next-intl';
import plMessages from '../../../locales/pl/common.json';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { mswServer } from '../../../test-utils/msw/server';
import { PricingTierSectionOrganism } from './PricingTierSection.organism';
import { PricingComparisonTableOrganism } from './PricingComparisonTable.organism';

// Komponent używa useRouter tylko dla CTA "Scale" (router.push) — pełny
// next/router nie istnieje w jsdom, mock minimalnego kształtu wystarcza.
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), pathname: '/pricing', query: {} }),
}));

// Trailer sekcji (trust pills + PhoneMockup trio) nie niesie żadnej ceny,
// a ciągnie ciężkie zależności wizualne — poza scope tego strażnika.
vi.mock('./PricingTierSection.parts.organism', () => ({
  PricingCompareChapterOrganism: () => null,
  PricingTiersTrustFooterOrganism: () => null,
  PricingTiersMockupsOrganism: () => null,
}));

// Tryb wejścia (app vs get-app) to warstwa routingu, nie cen — realny hook
// ciągnie AuthProvider (useAppRole → useAuth), którego renderWithProviders
// celowo nie montuje. 'app' = pełne CTA marketingowe, maksimum powierzchni cen.
vi.mock('../../shared/hooks/useAppEntryMode', () => ({
  useAppEntryMode: () => 'app',
}));

// Bieżący plan zalogowanej stylistki — sterowalny per test. Domyślnie null
// (anonim), bo tak wygląda LP dla ruchu z zewnątrz.
const currentPlanMock = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: currentPlanMock.value
      ? { stylist_account: { pricing_plan: currentPlanMock.value } }
      : undefined,
  }),
}));

// Ceny w GROSZACH (kontrakt wire: PriceSlot.atom robi Math.round(amount/100)).
// Rzędy wielkości realne — brakujące /100 gdziekolwiek na ścieżce renderu
// materializuje się jako kwota 4-5 cyfrowa i wpada w killer-asercję niżej.
const PLANS_RESPONSE = {
  event: 'APPLICATION_SUCCESS',
  data: {
    plans: [
      { plan_id: 'FREE', monthly_price: 0, yearly_monthly_price: 0 },
      { plan_id: 'PRO', monthly_price: 6000, yearly_monthly_price: 4800 },
      { plan_id: 'PRO_PLUS', monthly_price: 9900, yearly_monthly_price: 7900 },
      { plan_id: 'STUDIO', monthly_price: 19900, yearly_monthly_price: 15900 },
      { plan_id: 'SCALE', monthly_price: null, yearly_monthly_price: null },
    ],
    currency: 'pln',
    is_fallback: false,
    fetched_at: '2026-07-02T00:00:00.000Z',
  },
};

const messages = plMessages as unknown as AbstractIntlMessages;

// Nota trialowa to `<p>` z kwotą w `<strong>` (tag <amount>), więc tekst jest
// rozbity na dwa węzły i zwykłe findByText go nie złapie. Matcher czyta całą
// treść akapitu.
const findTrialNote = (text: string) =>
  screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === text);

// Owner 2026-09-14: kwota do zapłaty po trialu jest pogrubiona. `strong` to
// semantyka wyróżnienia (widzi ją też czytnik ekranu), nie className.
const expectBoldAmount = (note: HTMLElement, amount: string) => {
  expect(within(note).getByText(amount).tagName).toBe('STRONG');
};

beforeEach(() => {
  currentPlanMock.value = null;
  mswServer.use(
    http.get('*/api/v1/pricing/get-plans', () =>
      HttpResponse.json(PLANS_RESPONSE)
    )
  );
});

describe('PricingTierSection render sanity (grosze → złote)', () => {
  it('miesięcznie: nota trialowa pokazuje cenę w złotych, nie w groszach', async () => {
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages,
    });

    // Realny szablon pl trialPriceAfter: "30 dni, potem {price} PLN/mies."
    // (Pro 6000 gr → 60 PLN, Studio 19900 gr → 199 PLN).
    const proNote = await findTrialNote('30 dni, potem 60 PLN/mies.');
    const studioNote = await findTrialNote('30 dni, potem 199 PLN/mies.');
    expectBoldAmount(proNote, '60 PLN/mies.');
    expectBoldAmount(studioNote, '199 PLN/mies.');
    // Owner 2026-08-19: slot-bohater trial/free pokazuje 0 PLN, nie sam tekst.
    expect(
      screen.getAllByText('Darmowy okres próbny 0 PLN').length
    ).toBeGreaterThan(0);
    screen.getByText('Za darmo 0 PLN');

    // Micro-price: 6000 gr / (100*30) = 2,0 (separator dziesiętny locale pl).
    expect(document.body.textContent).toMatch(/~2,0 PLN\/dzień/);
  });

  it('rocznie: nota trialowa i oszczędność liczone w złotych', async () => {
    renderWithProviders(<PricingTierSectionOrganism isYearly={true} />, {
      messages,
    });

    // trialPriceAfterYearly: "30 dni, potem {price} PLN/mies., rozliczane
    // rocznie" (Pro yearly 4800 gr → 48 PLN).
    const proNote = await findTrialNote(
      '30 dni, potem 48 PLN/mies., rozliczane rocznie'
    );
    expectBoldAmount(proNote, '48 PLN/mies.');
    // (6000-4800)*12/100 = 144 zł rocznie.
    screen.getByText(/Oszczędzasz 144 PLN rocznie/);
  });

  it.each([false, true])(
    'killer-asercja (isYearly=%s): żadna wyrenderowana kwota nie ma 4+ cyfr',
    async isYearly => {
      renderWithProviders(<PricingTierSectionOrganism isYearly={isYearly} />, {
        messages,
      });
      // Bramka osiedlenia: nota trialowa istnieje DOPIERO po załadowaniu cen
      // (goły /PLN\/mies\./ matchuje priceUnit renderowany już ze skeletonem,
      // więc asercja pobiegłaby PRZED cenami i przeszła trywialnie).
      // findAll: "30 dni, potem" żyje na każdej płatnej karcie (period-
      // agnostyczne), więc jedna bramka działa dla monthly i yearly.
      await screen.findAllByText(
        (_, el) =>
          el?.tagName === 'P' && /30 dni, potem/.test(el.textContent ?? '')
      );

      // Brakujące /100 na DOWOLNEJ ścieżce (nota, micro-price, saving,
      // anchoring, PriceSlot) renderuje 4800/6000/9900/19900 → fail.
      // Asercja na tablicy dopasowań: failure pokazuje KTÓRE kwoty złapano.
      // Czytamy warstwę DOSTĘPNĄ (to, co widzi screen-reader): tory odometru
      // PriceSlota są aria-hidden i czytają się literalnie jako "0123456789"
      // per cyfra — realna kwota żyje w sr-only, surowy textContent kłamie.
      const accessible = document.body.cloneNode(true) as HTMLElement;
      accessible
        .querySelectorAll('[aria-hidden="true"]')
        .forEach(el => el.remove());
      const rendered = accessible.textContent ?? '';
      // Wzorzec A: goła kwota 4+ cyfrowa przy walucie. Świadomy trade-off:
      // legalna przyszła cena >=1000 PLN też by failowała — przy takiej
      // zmianie cennika zaktualizuj mock i tę asercję (guard woli krzyczeć).
      // Wzorzec B: kwota grupowana ("19 900 PLN", "19,900 PLN") — Intl
      // z separatorem tysięcy ominąłby wzorzec A (spar S39-closing F3).
      const groszeLeaks = [
        ...rendered.matchAll(/.{0,25}\d{4,}\s*(?:PLN|zł).{0,10}/g),
        ...rendered.matchAll(
          /.{0,25}\d{1,3}(?:[\s.,]\d{3})+\s*(?:PLN|zł).{0,10}/g
        ),
      ].map(m => m[0]);
      // Wzorzec C: sentinele — surowe wartości groszowe z mocka pojawiające
      // się GDZIEKOLWIEK w tekście (także bez sufiksu waluty, w dowolnym
      // formatowaniu z separatorem) = wyciek jednostek.
      const sentinels = ['4800', '6000', '9900', '19900', '15900', '7900'];
      const sentinelLeaks = sentinels.filter(v => {
        const grouped = `${v.slice(0, -3)}[\\s.,]?${v.slice(-3)}`;
        return new RegExp(`(?<!\\d)${grouped}(?!\\d)`).test(rendered);
      });
      expect(groszeLeaks).toEqual([]);
      expect(sentinelLeaks).toEqual([]);
    }
  );
});

// Głos ownera S98/B, temat ZAMKNIĘTY: „polecany" to rekomendacja, więc znika,
// gdy decyzja już zapadła. Cennik jako JEDYNA z trzech powierzchni znających stan
// użytkownika tego nie
// robił (onboarding i strona płatności miały to od początku) i reklamował
// stylistce plan, na którym właśnie jest. Do tego negatyw był kluczowany
// twardym `tier.id === 'pro'` zamiast flagą `tier.isRecommended`, czyli stał
// na drugim źródle prawdy obok tabeli porównania. Ani typecheck, ani żaden
// audyt nie widzą tej klasy — dlatego strażnikiem jest test.
describe('PricingTierSection — wybrany plan bije rekomendację (S98/B)', () => {
  const RECOMMENDED_NOTE = 'Polecany dla stylistek solo';

  it('anonim widzi rekomendację na planie Pro', async () => {
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages,
    });
    await screen.findAllByText(
      (_, el) =>
        el?.tagName === 'P' && /30 dni, potem/.test(el.textContent ?? '')
    );
    expect(screen.getAllByText(RECOMMENDED_NOTE).length).toBe(1);
  });

  it('stylistka NA planie Pro nie widzi go już jako polecanego', async () => {
    currentPlanMock.value = 'PRO';
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages,
    });
    await screen.findAllByText(
      (_, el) =>
        el?.tagName === 'P' && /30 dni, potem/.test(el.textContent ?? '')
    );
    expect(screen.queryByText(RECOMMENDED_NOTE)).toBeNull();
  });

  it('stylistka na INNYM planie nadal widzi rekomendację', async () => {
    currentPlanMock.value = 'STUDIO';
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages,
    });
    await screen.findAllByText(
      (_, el) =>
        el?.tagName === 'P' && /30 dni, potem/.test(el.textContent ?? '')
    );
    expect(screen.getAllByText(RECOMMENDED_NOTE).length).toBe(1);
  });
});

// Ten sam strażnik, drugi host. Runda 3 wykazała, że test powyżej był zielony
// przez cały czas, gdy tabela porównania łamała tę samą regułę jeden scroll
// niżej: asercje dotyczyły wyłącznie kart, a tabela jest w sekcji MOCKOWANA
// (patrz mock PricingTierSection.parts.organism). Strażnik, który pokrywa
// połowę powierzchni reguły, daje dokładnie tyle pewności, ile jej pokrywa.
describe('PricingComparisonTable — wybrany plan bije rekomendację (S98/B)', () => {
  const RECOMMENDED_CHIP = 'Polecany';

  it('anonim widzi chip „Polecany" w kolumnie Pro', async () => {
    renderWithProviders(<PricingComparisonTableOrganism />, { messages });
    await screen.findAllByText(/Pro/);
    expect(screen.getAllByText(RECOMMENDED_CHIP).length).toBeGreaterThan(0);
  });

  it('stylistka NA planie Pro nie widzi go już jako polecanego', async () => {
    currentPlanMock.value = 'PRO';
    renderWithProviders(<PricingComparisonTableOrganism />, { messages });
    await screen.findAllByText(/Pro/);
    expect(screen.queryByText(RECOMMENDED_CHIP)).toBeNull();
  });
});
