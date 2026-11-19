// UI/features/pairing/hooks/useQrScanner.ts
// Scanner engine: camera, decode loop and profile identifier resolution.
// The view layer (QrScannerDialog) only knows the PHASE and the stylist found.
// DECISION and rationale for two-track decoding: QrScannerDialog.organism.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';
import type jsQRType from 'jsqr';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../../application/http/toPromise.adapter';
import { getPublicProfile_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { requestMaxBrightness } from '../../../../application/platform/screen-brightness';
import type { ScreenBrightnessLease } from '../../../../application/platform/screen-brightness';
import { hapticImpact } from '../../../../application/platform/haptics';

/* ─── Decoding ─── */

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

/** Path segment `/stylist/[identifier]`: vanity_url or account_id. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PROFILE_SEGMENT = ROUTES_FRONT.STYLIST_PROFILE.split('/')[1] ?? 'stylist';

/**
 * Extracts the profile identifier from the scanned text.
 *
 * The host is deliberately NOT checked: a poster printed from production also
 * scans on staging, and even a foreign address with the same path shape gives
 * nothing, since the identifier goes to OUR backend and ends in „not found”.
 * We never navigate to the scanned URL, so a foreign host is not a vector.
 */
export function extractStylistIdentifier(raw: string): string | null {
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    // Not a URL: a bare identifier is allowed (a QR with the id instead of a
    // full address). There is NO manual code entry in this flow; the decoder
    // loop is the only caller.
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
 * Phase after a failed profile check. No network != „this is not a Nailfolio
 * code": every exception used to end as `notFound`, so on a weak connection a
 * stylist's real code was announced as foreign or removed.
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

/* ─── State ─── */

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
/** The decoder does not need full resolution, and pixels cost battery. */
const DECODE_MAX_WIDTH = 640;

export interface QrScannerState {
  phase: ScannerPhase;
  found: FoundStylist | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Back to scanning after a failed read or after dropping the result. */
  rescan: () => void;
  /** Restarts the camera FROM SCRATCH (another `getUserMedia`): the only way out of the
   *  `denied` phase, where there never was a stream and `rescan()` has nothing to resume. */
  restart: () => void;
}

export function useQrScanner(open: boolean): QrScannerState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const brightnessRef = useRef<ScreenBrightnessLease | null>(null);
  // Latch: the decode loop runs for a fraction of a second after a hit, and
  // without this a second read of the same code started a second lookup.
  const handledRef = useRef(false);

  const [phase, setPhase] = useState<ScannerPhase>('starting');
  const [found, setFound] = useState<FoundStylist | null>(null);
  /**
   * DECISION: the attempt counter is a DEPENDENCY of the effect that starts the camera, the
   * only way to walk the whole `getUserMedia` path again within one dialog opening. `rescan()`
   * only flips the phase and suffices while the stream lives. After a permission denial there
   * is NO stream, so without asking the browser again she would see a dead preview. Do not
   * promote it to a ref: the effect must remount and a ref does not trigger a render. */
  const [attempt, setAttempt] = useState(0);

  /**
   * Attaches the current stream to the CURRENT `<video>` element.
   *
   * DECISION: the view mounts the camera preview only in the "scanning" branch, so after a
   * hit React unmounts `<video>` and "Skanuj jeszcze raz" creates a BRAND NEW element.
   * Without re-attaching, the camera stayed on but blind (`readyState` never reached
   * HAVE_CURRENT_DATA) and the only way out was closing the dialog.
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
      // Playback can be rejected on going to the background; the next render
      // (or returning to the foreground) tries again.
    }
  }, []);

  // After every phase change the `<video>` element may be another one (or gone):
  // attaching must follow the tree, not the one-time camera start.
  useEffect(() => {
    void attachStream();
  }, [phase, attachStream]);

  const handleDecoded = useCallback(
    async (raw: string, isCurrent: () => boolean) => {
      const identifier = extractStylistIdentifier(raw);
      if (identifier === null) {
        // Not a Nailfolio code: stay in scanning, the camera keeps aiming at
        // further codes; release the latch so the right code can be caught.
        handledRef.current = false;
        return;
      }
      setPhase('lookingUp');
      try {
        const profile = await getPublicProfile_IO(
          { identifier },
          { silentBusinessError: true }
        );
        if (!isCurrent()) {
          return;
        }
        const account = profile?.account;
        if (account === undefined || account === null) {
          setPhase('notFound');
          return;
        }
        setFound({
          accountId: account.account_id,
          // `||`: an empty name (role-only onboarding) falls through to the
          // business name; the dialog adds the localized fallback after that.
          displayName: account.display_name || account.business_name || '',
          city: account.address_city ?? null,
          avatarUrl: account.avatar_url ?? null,
        });
        // The camera caught the code and the stylist is known: one light
        // vibration, so she can lower the phone without watching the screen
        // (an outcome with no server event of its own; policy in
        // `application/platform/haptic-events.config.ts`).
        void hapticImpact('Light');
        setPhase('found');
      } catch (error) {
        if (isCurrent()) {
          setPhase(lookupFailurePhase(error));
        }
      }
    },
    []
  );

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

      // DECISION: resources are held in LOCAL variables and cleaned up through `abandon()`, not
      // through `stopCamera()` from the closure. Between `getUserMedia` and `requestMaxBrightness`
      // there are two `await`s (the second dynamically imports the Capacitor bridge, a real chunk
      // fetch), so closing the dialog in that window runs cleanup BEFORE the references reach the
      // refs: `stopCamera()` then sees null and the camera stream and wake lock stay alive with no
      // handle.
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
        // The screen is a tool now: it must not dim mid-aim (wake lock works
        // everywhere, brightness only with the plugin).
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
            if (
              !cancelled &&
              !handledRef.current &&
              value !== null &&
              value !== ''
            ) {
              handledRef.current = true;
              await handleDecoded(value, () => !cancelled);
            }
          } catch {
            // A single failed frame means nothing; the next one comes in a
            // quarter of a second.
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
    // The effect on [phase] attaches the stream to the new <video> after render.
  }, []);

  const restart = useCallback(() => {
    setAttempt(previous => previous + 1);
  }, []);

  return { phase, found, videoRef, canvasRef, rescan, restart };
}
