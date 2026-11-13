import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ImageUp,
  KeyRound,
  AlertCircle,
} from 'lucide-react';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import { generateRandomId } from '../../services/qrService';
import type { CatchRequest, MemberRecord, TeamPublic } from '../../types/game';

interface NativeDetectedBarcode {
  rawValue?: string;
}

interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<NativeDetectedBarcode[]>;
}

interface WindowWithBarcodeDetector {
  BarcodeDetector?: new (options?: { formats?: string[] }) => NativeBarcodeDetector;
}

export interface SeekerScannerViewProps {
  adapter: DatabaseAdapter;
  sessionId: string;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  gameRunning: boolean;
}

export const SeekerScannerView: React.FC<SeekerScannerViewProps> = ({
  adapter,
  sessionId,
  ownMember,
  ownTeam,
  gameRunning,
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanPreviewNotice, setScanPreviewNotice] = useState<string | null>(null);
  const [photoDecoding, setPhotoDecoding] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [watchedCatch, setWatchedCatch] = useState<CatchRequest | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileDecoderRef = useRef<Html5Qrcode | null>(null);
  const scanLoopTimerRef = useRef<number | null>(null);
  const isDecodingFrameRef = useRef<boolean>(false);

  const gameRunningRef = useRef<boolean>(gameRunning);
  gameRunningRef.current = gameRunning;

  const rawDomId = useId().replace(/:/g, '');
  const hiddenDecoderSinkId = `sardinen-qr-sink-${rawDomId}`;

  useEffect(() => {
    if (!activeRequestId) return;
    return adapter.subscribeOwnCatchRequest(activeRequestId, setWatchedCatch);
  }, [adapter, activeRequestId]);

  const stopCameraStream = useCallback(() => {
    if (scanLoopTimerRef.current !== null) {
      window.clearInterval(scanLoopTimerRef.current);
      scanLoopTimerRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignorieren
        }
      }
    }
    const videoEl = videoRef.current;
    if (videoEl) {
      try {
        videoEl.pause();
      } catch {
        // Ignorieren
      }
      videoEl.srcObject = null;
    }
    isDecodingFrameRef.current = false;
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCameraStream();
      if (fileDecoderRef.current) {
        try {
          fileDecoderRef.current.clear();
        } catch {
          // Ignorieren
        }
        fileDecoderRef.current = null;
      }
    };
  }, [stopCameraStream]);

  const getOrCreateFileDecoder = useCallback((): Html5Qrcode | null => {
    if (fileDecoderRef.current) return fileDecoderRef.current;
    if (typeof document === 'undefined' || !document.getElementById(hiddenDecoderSinkId)) {
      return null;
    }
    const instance = new Html5Qrcode(hiddenDecoderSinkId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    });
    fileDecoderRef.current = instance;
    return instance;
  }, [hiddenDecoderSinkId]);

  const submitCode = useCallback(
    async (rawCodeOrPayload: string) => {
      if (!ownTeam || !rawCodeOrPayload.trim()) return;
      const reqId = generateRandomId('catch');
      const req: CatchRequest = {
        id: reqId,
        teamId: ownTeam.id,
        submittedByUid: ownMember.uid,
        sessionId,
        codeOrSecret: rawCodeOrPayload.trim(),
        status: 'PENDING',
        createdAt: adapter.getServerNow(),
      };
      setActiveRequestId(reqId);
      await adapter.submitCatchRequest(req);
    },
    [adapter, ownMember.uid, ownTeam, sessionId]
  );

  const handleDecodedPayload = useCallback(
    (decodedText: string) => {
      const cleaned = decodedText.trim();
      if (!cleaned) return;
      stopCameraStream();
      setCameraError(null);

      if (!gameRunningRef.current) {
        setScanPreviewNotice(
          'QR-Code erfolgreich erkannt! Ein offizieller Catch wird gewertet, sobald die offene Suchphase läuft.'
        );
        return;
      }

      setScanPreviewNotice(null);
      void submitCode(cleaned);
    },
    [stopCameraStream, submitCode]
  );

  // Laufende Frame-Dekodierung (Native BarcodeDetector + ZXing-Fallback für iOS Safari / Firefox)
  useEffect(() => {
    if (!cameraActive) return;

    let cancelled = false;
    const DetectorCtor = (window as unknown as WindowWithBarcodeDetector)
      .BarcodeDetector;
    let nativeDetector: NativeBarcodeDetector | null = null;
    if (DetectorCtor) {
      try {
        nativeDetector = new DetectorCtor({ formats: ['qr_code'] });
      } catch {
        nativeDetector = null;
      }
    }

    const decodeSingleFrame = async () => {
      if (cancelled || isDecodingFrameRef.current) return;
      const videoEl = videoRef.current;
      if (
        !videoEl ||
        videoEl.readyState < 2 ||
        videoEl.videoWidth <= 0 ||
        videoEl.videoHeight <= 0
      ) {
        return;
      }

      isDecodingFrameRef.current = true;
      try {
        // 1. Ultraschneller nativer Hardware-QR-Decoder (Android Chrome, Desktop Chrome/Edge, neuere WebKit)
        if (nativeDetector) {
          try {
            const hits = await nativeDetector.detect(videoEl);
            const hitText = hits.find((h) => h.rawValue?.trim())?.rawValue;
            if (hitText && !cancelled) {
              handleDecodedPayload(hitText);
              return;
            }
          } catch {
            // Weiter zum Canvas-ZXing-Fallback
          }
        }

        // 2. Universeller Canvas -> ZXing Fallback (insb. für iOS Safari & PWA)
        let canvas = canvasRef.current;
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvasRef.current = canvas;
        }
        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;
        const maxDim = 640;
        const scale = Math.min(1, maxDim / Math.max(vw, vh));
        const targetW = Math.max(120, Math.round(vw * scale));
        const targetH = Math.max(120, Math.round(vh * scale));
        canvas.width = targetW;
        canvas.height = targetH;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(videoEl, 0, 0, targetW, targetH);

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas!.toBlob(resolve, 'image/jpeg', 0.85)
        );
        if (!blob || cancelled) return;

        const decoder = getOrCreateFileDecoder();
        if (!decoder) return;

        const frameFile = new File([blob], 'qr-frame.jpg', {
          type: 'image/jpeg',
        });
        const decoded = await decoder.scanFile(frameFile, false);
        if (decoded && !cancelled) {
          handleDecodedPayload(decoded);
        }
      } catch {
        // Normaler Zustand solange noch kein QR-Code im Kamerabild ist
      } finally {
        isDecodingFrameRef.current = false;
      }
    };

    scanLoopTimerRef.current = window.setInterval(() => {
      void decodeSingleFrame();
    }, 180);

    return () => {
      cancelled = true;
      if (scanLoopTimerRef.current !== null) {
        window.clearInterval(scanLoopTimerRef.current);
        scanLoopTimerRef.current = null;
      }
    };
  }, [cameraActive, getOrCreateFileDecoder, handleDecodedPayload]);

  // WICHTIG: getUserMedia wird direkt synchron im onClick-Handler aufgerufen,
  // damit iOS Safari, Android Chrome und PWAs garantiert den Kamera-Berechtigungsdialog öffnen!
  const handleToggleCamera = async () => {
    if (cameraActive || cameraStarting) {
      stopCameraStream();
      return;
    }

    setCameraError(null);
    setScanPreviewNotice(null);

    if (
      typeof window !== 'undefined' &&
      !window.isSecureContext &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      setCameraError(
        'Live-Kamerazugriff wird vom Browser nur über HTTPS (oder localhost) erlaubt. Bitte öffne die HTTPS-Adresse oder nutze direkt rechts den Button „QR-Foto aufnehmen“.'
      );
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCameraError(
        'Dein Browser stellt hier keine Live-Kamera-API bereit. Nutze bitte den Button „QR-Foto aufnehmen“ oder gib den Fang-Code unten ein.'
      );
      return;
    }

    setCameraStarting(true);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (firstErr) {
        const errName = firstErr instanceof DOMException ? firstErr.name : '';
        if (
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          errName === 'SecurityError'
        ) {
          throw firstErr;
        }
        // Fallback auf beliebige verfügbare Kamera (z.B. Laptop-Webcam oder spezielle Smartphone-Linse)
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      streamRef.current = stream;
      setCameraActive(true);
      setCameraStarting(false);

      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.setAttribute('playsinline', 'true');
        videoEl.muted = true;
        await videoEl.play().catch(() => {});
      }
    } catch (err) {
      stopCameraStream();
      const errName = err instanceof DOMException ? err.name : '';
      if (
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError'
      ) {
        setCameraError(
          'Kamera-Berechtigung wurde blockiert. Bitte erlaube den Kamerazugriff über das Schloss-Symbol in der Adressleiste oder nutze „QR-Foto aufnehmen“.'
        );
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setCameraError(
          'Es wurde keine Kamera auf diesem Gerät gefunden. Bitte gib unten den Fang-Code manuell ein.'
        );
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        setCameraError(
          'Die Kamera wird gerade von einer anderen App verwendet. Schließe andere Kamera-Apps oder nutze „QR-Foto aufnehmen“.'
        );
      } else {
        setCameraError(
          'Live-Kamera konnte nicht gestartet werden. Nutze alternativ „QR-Foto aufnehmen“ oder gib unten den Fang-Code ein.'
        );
      }
    }
  };

  const handlePhotoFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPhotoDecoding(true);
    setCameraError(null);
    setScanPreviewNotice(null);

    try {
      const DetectorCtor = (window as unknown as WindowWithBarcodeDetector)
        .BarcodeDetector;
      if (DetectorCtor && typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(file);
          const detector = new DetectorCtor({ formats: ['qr_code'] });
          const hits = await detector.detect(bitmap);
          bitmap.close?.();
          const hitText = hits.find((h) => h.rawValue?.trim())?.rawValue;
          if (hitText) {
            handleDecodedPayload(hitText);
            return;
          }
        } catch {
          // Weiter zu Html5Qrcode.scanFile
        }
      }

      const decoder = getOrCreateFileDecoder();
      if (!decoder) {
        throw new Error('Decoder nicht bereit');
      }
      const decodedText = await decoder.scanFile(file, false);
      handleDecodedPayload(decodedText);
    } catch {
      setCameraError(
        'Auf dem Foto wurde kein gültiger QR-Code erkannt. Halte die Kamera näher an den QR-Code oder gib den Fang-Code unten manuell ein.'
      );
    } finally {
      setPhotoDecoding(false);
    }
  };

  if (!ownTeam) {
    return (
      <div className="cmf-drafting-bg flex h-full items-center justify-center p-6 text-center">
        <div className="cmf-module max-w-sm p-5 text-sm text-[var(--text-muted)]">
          Du bist aktuell keinem Sucher-Team zugewiesen.
        </div>
      </div>
    );
  }

  return (
    <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
      {/* Unsichtbarer Sink-Container für den ZXing-Datei-/Frame-Decoder */}
      <div id={hiddenDecoderSinkId} className="hidden" aria-hidden="true" />

      <div className="mx-auto max-w-md space-y-4 pb-10">
        <div className="cmf-chassis cmf-card-enter p-4 sm:p-5">
          <span className="cmf-badge-orange inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            SARDINEN GEFUNDEN?
          </span>
          <h2 className="font-dot mt-1 text-lg sm:text-xl text-[var(--text-main)]">
            QR-Code scannen oder Verstecker-Code eingeben
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Sobald der Code bestätigt ist, stoppt eure Suchzeit sofort und euer gesamtes Team wechselt in das Sardinen-Versteck!
          </p>
        </div>

        {!gameRunning && (
          <div className="cmf-badge-amber rounded-2xl p-3.5 text-xs font-medium">
            Hinweis: Du kannst die Kamera schon jetzt testen & freigeben. Ein offizieller Catch wird gewertet, sobald die offene Suche läuft.
          </div>
        )}

        {/* Kamera-Scanner */}
        <div className="cmf-module p-4 space-y-3">
          <span className="font-industrial block text-sm text-[var(--text-main)]">
            1. Per Smartphone-Kamera scannen
          </span>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              data-testid="start-qr-camera-btn"
              onClick={() => void handleToggleCamera()}
              className={`font-dot inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold ${
                cameraActive ? 'cmf-btn-active' : 'cmf-btn-primary'
              }`}
            >
              {cameraActive ? (
                <>
                  <CameraOff className="h-4 w-4 text-[var(--nothing-red)]" /> Kamera stoppen
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  {cameraStarting ? 'Kamera startet ...' : 'QR-Code scannen'}
                </>
              )}
            </button>

            <label className="cmf-btn-secondary font-tech inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-1.5 px-3.5 py-2.5 text-[11px] font-bold uppercase">
              <ImageUp className="h-4 w-4 text-[var(--cmf-orange)]" />
              <span>{photoDecoding ? 'Prüfe Foto ...' : 'QR-Foto aufnehmen'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={photoDecoding}
                onChange={(e) => void handlePhotoFileScan(e)}
                className="hidden"
              />
            </label>
          </div>

          {/* Video-Element bleibt im DOM gemountet, damit iOS Safari den Stream ohne Render-Verzögerung abspielt */}
          <div
            className={`relative overflow-hidden rounded-xl ${
              cameraActive ? 'cmf-drawer-down block' : 'hidden'
            }`}
          >
            <div className="cmf-oled relative aspect-square max-h-[300px] w-full overflow-hidden p-1">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-full w-full rounded-lg object-cover"
              />
              {/* Taktiler Zielrahmen */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-dashed border-white/55"
              />
              <span
                aria-hidden="true"
                className="cmf-scan-line pointer-events-none absolute inset-x-4 top-3 h-0.5 rounded-full bg-[var(--cmf-orange)] shadow-[0_0_12px_#FF4D00]"
              />
            </div>
          </div>

          {scanPreviewNotice && (
            <p className="cmf-badge-teal rounded-xl p-2.5 text-xs font-semibold">
              {scanPreviewNotice}
            </p>
          )}

          {cameraError && (
            <p className="cmf-badge-amber rounded-xl p-2.5 text-xs font-medium">
              {cameraError}
            </p>
          )}
        </div>

        {/* Manuelle Passwort- / Fang-Code-Eingabe */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode(manualCode);
          }}
          className="cmf-module p-4 space-y-3"
        >
          <label
            htmlFor="manual-short-code"
            className="font-industrial flex items-center gap-2 text-sm text-[var(--text-main)]"
          >
            <KeyRound className="h-4 w-4 text-[var(--cmf-orange)]" />
            2. Verstecker-Code / Fang-Code eingeben
          </label>
          <div className="flex gap-2">
            <input
              id="manual-short-code"
              data-testid="manual-catch-code-input"
              type="text"
              enterKeyHint="send"
              autoComplete="off"
              maxLength={32}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Verstecker-Code ..."
              className="cmf-input cmf-input-orange font-tech min-h-[48px] flex-1 px-3.5 text-base font-bold tracking-wider"
            />
            <button
              type="submit"
              data-testid="submit-catch-code-btn"
              disabled={!gameRunning || manualCode.trim().length < 3}
              className="cmf-btn-primary font-dot min-h-[48px] px-5 text-xs font-bold"
            >
              Prüfen
            </button>
          </div>
        </form>

        {/* Live-Statusanzeige der Prüfung */}
        {watchedCatch && (
          <div
            data-testid="catch-feedback-box"
            className={`rounded-2xl p-4 text-xs font-semibold ${
              watchedCatch.status === 'ACCEPTED'
                ? 'cmf-badge-teal cmf-pop-in'
                : watchedCatch.status === 'INVALID'
                  ? 'cmf-badge-orange cmf-shake'
                  : 'cmf-oled cmf-card-enter text-[#F8FAFC]'
            }`}
          >
            {watchedCatch.status === 'PENDING' ||
            watchedCatch.status === 'PROCESSING' ? (
              <span className="font-tech uppercase">
                Code wird vom Controller-Gerät geprüft ...
              </span>
            ) : watchedCatch.status === 'ACCEPTED' ? (
              <span className="flex items-center gap-2 text-sm font-bold">
                <CheckCircle2 className="h-5 w-5 text-[var(--cmf-teal)]" />
                TREFFER! Euer gesamtes Team ist jetzt offiziell bei den Sardinen!
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                Ungültiger Code: {watchedCatch.errorMessage ?? 'Bitte erneut prüfen.'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
