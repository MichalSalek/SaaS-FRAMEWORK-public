// UI/features/pairing/hooks/useQrScanner.ts
// Silnik skanera: kamera, pętla dekodująca i rozwiązanie identyfikatora profilu.
// Warstwa widoku (QrScannerDialog) zna już tylko FAZĘ i znalezioną stylistkę.
// DECISION i uzasadnienie dwutorowego dekodowania: QrScannerDialog.organism.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';
import type jsQRType from 'jsqr';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../../application/http/toPromise.adapter';
import { getPublicProfile_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { requestMaxBrightness } from '../../../../application/platform/screen-brightness';
import type { ScreenBrightnessLease } from '../../../../application/platform/screen-brightness';

/* ─── Dekodowanie ─── */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const ctor = (window as unknown as Record<string, unknown>)[
    'BarcodeDetector'
  ];
  return typeof ctor === 'function' ? (ctor as BarcodeDetectorCtor) : null;
}

/** Segment ścieżki `/stylist/[identifier]` — vanity_url albo account_id. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PROFILE_SEGMENT = ROUTES_FRONT.STYLIST_PROFILE.split('/')[1] ?? 'stylist';

/**
 * Wyciąga identyfikator profilu z zeskanowanego tekstu.
 *
 * Świadomie NIE sprawdzamy hosta: plakat wydrukowany z produkcji skanuje się
 * też na staging, a nawet obcy adres o tym samym kształcie ścieżki nic nie da —
 * identyfikator i tak leci do NASZEGO backendu i kończy się „nie znaleziono".
 * Nigdzie nie nawigujemy pod zeskanowany URL, więc obcy host nie jest wektorem.
 */
export function extractStylistIdentifier(raw: string): string | null {
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    // Nie-URL: dopuszczamy goły identyfikator (QR z samym id zamiast pełnego
    // adresu). Ręcznego wpisywania kodu w tym flow NIE MA — jedynym wywołującym
    // jest pętla dekodera.
    const trimmed = raw.trim();
    return IDENTIFIER_PATTERN.test(trimmed) ? trimmed : null;
  }
  const segments = path.split('/').filter(Boolean);
  const index = segments.indexOf(PROFILE_SEGMENT);
  if (index === -1) {
    return null;
  }
  const identifier = segments[index + 1];
  if (identifier === undefined || !IDENTIFIER_PATTERN.test(identifier)) {
    return null;
  }
  return identifier;
}

/**
 * Faza po nieudanym sprawdzeniu profilu. Brak sieci ≠ „to nie jest kod
 * Nailfolio": wcześniej każdy wyjątek kończył się `notFound`, więc na słabym
 * zasięgu przy fotelu prawdziwy kod stylistki był ogłaszany jako obcy albo
 * usunięty.
 */
export function lookupFailurePhase(
  error: unknown
): 'lookupFailed' | 'notFound' {
  return isIOError(error) &&
    error.httpError.event ===
      APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM
    ? 'lookupFailed'
    : 'notFound';
}

/* ─── Stany ─── */

export type ScannerPhase =
  | 'starting'
  | 'scanning'
  | 'lookingUp'
  | 'found'
  | 'denied'
  | 'unsupported'
  | 'notFound'
  | 'lookupFailed';

export interface FoundStylist {
  accountId: string;
  displayName: string;
  city: string | null;
  avatarUrl: string | null;
}

const SCAN_INTERVAL_MS = 250;
/** Dekoder nie potrzebuje pełnej rozdzielczości, a piksele kosztują baterię. */
const DECODE_MAX_WIDTH = 640;

export interface QrScannerState {
  phase: ScannerPhase;
  found: FoundStylist | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Wraca do skanowania po nieudanym odczycie albo po rezygnacji z wyniku. */
  rescan: () => void;
  /**
   * Startuje kamerę OD ZERA (ponowne `getUserMedia`) — jedyne wyjście z fazy
   * `denied`, gdzie strumienia nigdy nie było i `rescan()` nie ma czego wznowić.
   */
  restart: () => void;
}

export function useQrScanner(open: boolean): QrScannerState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const brightnessRef = useRef<ScreenBrightnessLease | null>(null);
  // Zatrzask: pętla dekodująca chodzi dalej przez ułamek sekundy po trafieniu,
  // a bez tego drugi odczyt tego samego kodu startował drugi lookup.
  const handledRef = useRef(false);

  const [phase, setPhase] = useState<ScannerPhase>('starting');
  const [found, setFound] = useState<FoundStylist | null>(null);
  /**
   * DECISION (nie usuwaj tego komentarza): licznik prób jest ZALEŻNOŚCIĄ efektu
   * uruchamiającego kamerę, bo to jedyny sposób, żeby przejść całą ścieżkę
   * `getUserMedia` jeszcze raz w tym samym otwarciu dialogu. `rescan()` tylko
   * przestawia fazę i wystarcza, dopóki strumień żyje (po trafieniu kodu albo
   * po obcym kodzie). Po odmowie zgody strumienia NIE MA — kobieta nadaje
   * uprawnienie w ustawieniach systemu i wraca, a bez ponownego zapytania
   * przeglądarki widziałaby martwy podgląd. Nie podnoś tego do refa: efekt musi
   * się przemontować, a ref nie odpala renderu.
   */
  const [attempt, setAttempt] = useState(0);

  /**
   * Przypina bieżący strumień do AKTUALNEGO elementu `<video>`.
   *
   * DECISION (nie usuwaj tego komentarza): widok montuje podgląd kamery tylko
   * w gałęzi „skanowanie" — po trafieniu kodu React odmontowuje `<video>`, a
   * „Skanuj jeszcze raz" tworzy CAŁKIEM NOWY element. Bez ponownego przypięcia
   * kamera zostawała włączona, ale ślepa: `readyState` nigdy nie dochodził do
   * HAVE_CURRENT_DATA, więc pętla dekodująca w kółko zwracała pustkę i jedynym
   * wyjściem było zamknięcie dialogu.
   */
  const attachStream = useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) {
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Odtwarzanie bywa odrzucone przy przejściu w tło; kolejny render
      // (albo powrót na pierwszy plan) spróbuje ponownie.
    }
  }, []);

  // Po każdej zmianie fazy element `<video>` może być inny (albo zniknąć):
  // przypięcie musi iść ZA drzewem, nie za jednorazowym startem kamery.
  useEffect(() => {
    void attachStream();
  }, [phase, attachStream]);

  const handleDecoded = useCallback(async (raw: string) => {
    const identifier = extractStylistIdentifier(raw);
    if (identifier === null) {
      // Kod nie z Nailfolio — zostajemy w skanowaniu, bo aparat i tak celuje
      // w kolejne kody; zatrzask zwalniamy, żeby właściwy kod dało się złapać.
      handledRef.current = false;
      return;
    }
    setPhase('lookingUp');
    try {
      const profile = await getPublicProfile_IO(
        { identifier },
        { silentBusinessError: true }
      );
      const account = profile?.account;
      if (account === undefined || account === null) {
        setPhase('notFound');
        return;
      }
      setFound({
        accountId: account.account_id,
        displayName: account.display_name ?? account.business_name ?? '',
        city: account.address_city ?? null,
        avatarUrl: account.avatar_url ?? null,
      });
      setPhase('found');
    } catch (error) {
      setPhase(lookupFailurePhase(error));
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    handledRef.current = false;
    setFound(null);
    setPhase('starting');

    const stopCamera = () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      void brightnessRef.current?.release();
      brightnessRef.current = null;
    };

    const decodeFrame = async (
      detector: BarcodeDetectorLike | null,
      jsQR: typeof jsQRType | null
    ): Promise<string | null> => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        return null;
      }
      if (detector) {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue ?? null;
      }
      const canvas = canvasRef.current;
      if (!canvas || !jsQR) {
        return null;
      }
      const width = Math.min(video.videoWidth, DECODE_MAX_WIDTH);
      const height = Math.round((video.videoHeight / video.videoWidth) * width);
      if (!width || !height) {
        return null;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return null;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      return jsQR(image.data, width, height)?.data ?? null;
    };

    const start = async () => {
      const detectorCtor = getBarcodeDetectorCtor();
      let detector: BarcodeDetectorLike | null = null;
      let jsQR: typeof jsQRType | null = null;

      if (detectorCtor) {
        try {
          detector = new detectorCtor({ formats: ['qr_code'] });
        } catch {
          detector = null;
        }
      }
      if (!detector) {
        try {
          jsQR = (await import('jsqr')).default;
        } catch {
          if (!cancelled) {
            setPhase('unsupported');
          }
          return;
        }
      }

      // DECISION (nie usuwaj tego komentarza): zasoby trzymamy w zmiennych
      // LOKALNYCH i sprzątamy je przez `abandon()`, nie przez `stopCamera()` z
      // domknięcia. Między `getUserMedia` a `requestMaxBrightness` są dwa
      // `await` (drugi robi dynamiczny import mostka Capacitora, czyli realny
      // fetch chunku), więc zamknięcie dialogu w tym oknie odpala cleanup
      // ZANIM referencje trafią do refów — `stopCamera()` widzi wtedy null,
      // a strumień kamery i wake lock zostają żywe bez uchwytu.
      let localStream: MediaStream | null = null;
      let localLease: ScreenBrightnessLease | null = null;
      const abandon = () => {
        localStream?.getTracks().forEach(track => track.stop());
        void localLease?.release();
        if (streamRef.current === localStream) {
          streamRef.current = null;
        }
        if (brightnessRef.current === localLease) {
          brightnessRef.current = null;
        }
      };

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          abandon();
          return;
        }
        streamRef.current = localStream;
        await attachStream();
        // Ekran jest teraz narzędziem: nie wolno mu przygasnąć w połowie
        // celowania (wake lock działa wszędzie, jasność dopiero z pluginem).
        localLease = await requestMaxBrightness();
        if (cancelled) {
          abandon();
          return;
        }
        brightnessRef.current = localLease;
        setPhase('scanning');
      } catch {
        abandon();
        if (!cancelled) {
          setPhase('denied');
        }
        return;
      }

      timer = window.setInterval(() => {
        void (async () => {
          if (cancelled || handledRef.current) {
            return;
          }
          try {
            const value = await decodeFrame(detector, jsQR);
            if (value !== null && value !== '') {
              handledRef.current = true;
              await handleDecoded(value);
            }
          } catch {
            // Pojedyncza nieudana klatka nic nie znaczy — kolejna przyjdzie za
            // ćwierć sekundy.
          }
        })();
      }, SCAN_INTERVAL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
      stopCamera();
    };
  }, [open, attempt, handleDecoded, attachStream]);

  const rescan = useCallback(() => {
    handledRef.current = false;
    setFound(null);
    setPhase('scanning');
    // Efekt na [phase] przypnie strumień do nowego <video> po renderze.
  }, []);

  const restart = useCallback(() => {
    setAttempt(previous => previous + 1);
  }, []);

  return { phase, found, videoRef, canvasRef, rescan, restart };
}
