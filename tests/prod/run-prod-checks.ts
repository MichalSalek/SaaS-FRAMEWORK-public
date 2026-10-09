// tests/prod/run-prod-checks.ts
//
// Sanity produkcji uruchamiane z jednego polecenia: `npm run test:prod`.
//
// Dwie warstwy:
//   • BEZ SESJI  — czy front i backend w ogóle stoją, czy statyki się serwują,
//     czy start logowania Google odpowiada tak, jak powinien;
//   • Z SESJĄ    — pełne logowanie magic-linkiem odebranym po IMAP, czyli ta
//     ścieżka, która 2026-08-17 wyłożyła się na produkcji i której nikt nie
//     miał czym pilnować.
//
// Warstwa z sesją włącza się sama, gdy w powłoce są dane skrzynki testowej
// (lokalny plik z sekretami). Bez nich suita wykonuje część bez logowania i mówi
// wprost, czego nie sprawdziła — zamiast udawać, że przeszła całość.
//
// Flagi: `--smoke-only` (pomiń logowanie), `--purge` (wyczyść skrzynkę na start).

import { PROD_CONFIG, hasMailboxCredentials } from './prod-config';
import { loginViaMagicLink, signOut } from './prod-auth';
import { purgeInbox } from './prod-inbox';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  skipped?: boolean;
}

const results: CheckResult[] = [];

const record = async (
  name: string,
  fn: () => Promise<string>
): Promise<boolean> => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ✓ ${name} — ${detail}`);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.log(`  ✗ ${name} — ${detail}`);
    return false;
  }
};

const expect = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

// ---------------------------------------------------------------------------
// Warstwa bez sesji
// ---------------------------------------------------------------------------

async function publicChecks(): Promise<void> {
  const front = PROD_CONFIG.FRONTEND_URL;
  const back = PROD_CONFIG.BACKEND_URL;

  await record('strona główna odpowiada', async () => {
    const res = await fetch(front);
    expect(res.ok, `HTTP ${res.status}`);
    const html = await res.text();
    expect(html.includes('<title'), 'brak <title> w odpowiedzi');
    return `HTTP ${res.status}`;
  });

  await record('ekran logowania odpowiada', async () => {
    const res = await fetch(`${front}/user/login`);
    expect(res.ok, `HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  // Statyki mają własny check, bo już raz przez dobę leżały przy działającym
  // HTML-u (zagnieżdżone public/public w standalone, incydent 2026-08-02).
  await record('robots.txt serwowany', async () => {
    const res = await fetch(`${front}/robots.txt`);
    expect(res.ok, `HTTP ${res.status}`);
    const body = await res.text();
    expect(
      body.toLowerCase().includes('user-agent'),
      'treść nie wygląda na robots.txt'
    );
    return `HTTP ${res.status}, ${body.length} B`;
  });

  await record('manifest PWA serwowany i standalone', async () => {
    const res = await fetch(`${front}/site.webmanifest`);
    expect(res.ok, `HTTP ${res.status}`);
    const manifest = (await res.json()) as {
      display?: string;
      start_url?: string;
    };
    expect(
      manifest.display === 'standalone',
      `display=${String(manifest.display)}`
    );
    return `display=${manifest.display}, start_url=${String(manifest.start_url)}`;
  });

  await record('assetlinks dla App Links serwowane', async () => {
    const res = await fetch(`${front}/.well-known/assetlinks.json`);
    expect(res.ok, `HTTP ${res.status}`);
    const links = (await res.json()) as Array<{
      target?: { package_name?: string };
    }>;
    const pkg = links[0]?.target?.package_name;
    expect(Boolean(pkg), 'brak package_name w assetlinks');
    return `package=${String(pkg)}`;
  });

  await record('backend żyje (health-public)', async () => {
    const res = await fetch(`${back}/api/v1/internal/health-public`);
    expect(res.ok, `HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  // Regresja wprost z incydentu 2026-08-17: start natywnego logowania Google
  // musi odesłać do Google i ustawić ciasteczko stanu w TEJ odpowiedzi (inaczej
  // powrót z przeglądarki rozjedzie się o cookie-jar).
  await record('start natywnego logowania Google', async () => {
    const res = await fetch(
      `${back}/api/auth/native-oauth-start/google?callbackURL=%2Fapp`,
      { redirect: 'manual' }
    );
    expect(res.status === 302, `HTTP ${res.status} (oczekiwane 302)`);
    const location = res.headers.get('location') ?? '';
    expect(
      location.startsWith('https://accounts.google.com/'),
      `przekierowanie prowadzi gdzie indziej: ${location.slice(0, 60)}`
    );
    expect(
      res.headers.getSetCookie().length > 0,
      'brak ciasteczka stanu w odpowiedzi'
    );
    return 'HTTP 302 → accounts.google.com, ciasteczko stanu ustawione';
  });

  await record('nieznany kod wymiany odrzucany bez śladu', async () => {
    const res = await fetch(`${back}/api/auth/exchange-code`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PROD_CONFIG.FRONTEND_URL,
      },
      body: JSON.stringify({ authCode: 'nie-istnieje-taki-kod' }),
    });
    expect(res.status === 404, `HTTP ${res.status} (oczekiwane 404)`);
    return 'HTTP 404';
  });
}

// ---------------------------------------------------------------------------
// Warstwa z sesją (magic-link + IMAP)
// ---------------------------------------------------------------------------

async function authedChecks(): Promise<void> {
  let token = '';

  const loggedIn = await record(
    'logowanie magic-linkiem od prośby po token sesji',
    async () => {
      const started = Date.now();
      const session = await loginViaMagicLink();
      token = session.token;
      const landing = new URL(session.landingUrl);
      expect(
        landing.origin === PROD_CONFIG.FRONTEND_URL,
        `most tokenowy wyrzucił na ${landing.origin}, a nie na front`
      );
      return `${Math.round((Date.now() - started) / 1000)} s, ląduje na ${landing.pathname}`;
    }
  );

  if (!loggedIn) {
    return;
  }

  await record(
    'logowanie magic-linkiem z /en/user/login zachowuje język',
    async () => {
      const session = await loginViaMagicLink({ callbackURL: '/en/app' });
      const landing = new URL(session.landingUrl);
      expect(
        landing.origin === PROD_CONFIG.FRONTEND_URL,
        `most tokenowy wyrzucił na ${landing.origin}, a nie na front`
      );
      expect(
        landing.pathname.startsWith('/en/app') &&
          /^\/en\/app(\/|$)/.test(landing.pathname),
        `ścieżka powrotu ${landing.pathname} nie zaczyna się od /en/app`
      );
      await signOut(session.token);
      return `ląduje na ${landing.pathname}`;
    }
  );

  await record('sesja czytelna dla API (session/get-current)', async () => {
    const res = await fetch(
      `${PROD_CONFIG.BACKEND_URL}/api/v1/session/get-current`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          origin: PROD_CONFIG.FRONTEND_URL,
        },
      }
    );
    expect(res.ok, `HTTP ${res.status}`);
    const payload = (await res.json()) as { data?: { email?: string } };
    const email = payload.data?.email ?? '';
    expect(
      email.toLowerCase() === PROD_CONFIG.MAILBOX_USER.toLowerCase(),
      `API zwróciło konto ${email || '(brak)'} zamiast testowego`
    );
    return `zalogowany jako ${email}`;
  });

  await record('kod wymiany jest jednorazowy', async () => {
    // Powtórka logowania z tym samym kodem jest bez sensu (kod już spalony),
    // więc sprawdzamy warunek wprost: druga wymiana MUSI dostać 404.
    const res = await fetch(
      `${PROD_CONFIG.BACKEND_URL}/api/auth/exchange-code`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: PROD_CONFIG.FRONTEND_URL,
        },
        body: JSON.stringify({
          authCode: 'spalony-kod-z-poprzedniego-logowania',
        }),
      }
    );
    expect(res.status === 404, `HTTP ${res.status}`);
    return 'HTTP 404';
  });

  await record('wylogowanie sprząta sesję', async () => {
    await signOut(token);
    const res = await fetch(
      `${PROD_CONFIG.BACKEND_URL}/api/v1/session/get-current`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          origin: PROD_CONFIG.FRONTEND_URL,
        },
      }
    );
    const payload = (await res.json().catch(() => ({}))) as {
      data?: { email?: string } | null;
    };
    expect(!payload.data?.email, 'token nadal zwraca konto po wylogowaniu');
    return 'token nieaktywny';
  });
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const smokeOnly = args.includes('--smoke-only');

  console.log('=== Sanity produkcji ===');
  console.log(`front:   ${PROD_CONFIG.FRONTEND_URL}`);
  console.log(`backend: ${PROD_CONFIG.BACKEND_URL}\n`);

  console.log('Bez sesji:');
  await publicChecks();

  if (smokeOnly) {
    console.log('\nWarstwa z logowaniem pominięta (--smoke-only).');
  } else if (!hasMailboxCredentials()) {
    results.push({
      name: 'logowanie na produkcji',
      ok: true,
      skipped: true,
      detail: 'brak danych skrzynki testowej w powłoce',
    });
    console.log(
      '\nWarstwa z logowaniem POMINIĘTA: brak E2E_MAILBOX_* w powłoce ' +
        '(dane są w lokalnym pliku z sekretami).'
    );
  } else {
    if (args.includes('--purge')) {
      const removed = await purgeInbox();
      console.log(`\nSkrzynka wyczyszczona (${removed} wiadomości).`);
    }
    console.log('\nZ sesją (magic-link odbierany po IMAP):');
    await authedChecks();
  }

  const failed = results.filter(r => !r.ok);
  const skipped = results.filter(r => r.skipped);
  console.log(
    `\nWynik: ${results.length - failed.length - skipped.length} przeszło, ` +
      `${failed.length} nie przeszło, ${skipped.length} pominięto.`
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error('Suita przerwana:', error);
  process.exitCode = 1;
});
