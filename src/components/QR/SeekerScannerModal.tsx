import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, CheckCircle2, KeyRound, AlertCircle } from 'lucide-react';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import { generateRandomId } from '../../services/qrService';
import type { CatchRequest, MemberRecord, TeamPublic } from '../../types/game';

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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [watchedCatch, setWatchedCatch] = useState<CatchRequest | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerRegionId = 'sardinen-qr-reader-region';

  useEffect(() => {
    if (!activeRequestId) return;
    return adapter.subscribeOwnCatchRequest(activeRequestId, setWatchedCatch);
  }, [adapter, activeRequestId]);

  useEffect(() => {
    if (!cameraActive) return;

    let cancelled = false;
    const html5Qr = new Html5Qrcode(scannerRegionId);
    scannerRef.current = html5Qr;
    setCameraError(null);

    html5Qr
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          if (cancelled) return;
          setCameraActive(false);
          void submitCode(decodedText);
        },
        () => {
          // Laufende Frame-Nicht-Treffer ignorieren
        }
      )
      .catch(() => {
        if (!cancelled) {
          setCameraActive(false);
          setCameraError(
            'Kamera konnte nicht geöffnet werden. Bitte nutze unten die manuelle Eingabe des Verstecker-Passworts / Fang-Codes.'
          );
        }
      });

    return () => {
      cancelled = true;
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (instance) {
        if (instance.isScanning) {
          instance
            .stop()
            .then(() => instance.clear())
            .catch(() => {});
        } else {
          try {
            instance.clear();
          } catch {
            // Ignorieren
          }
        }
      }
    };
  }, [cameraActive]);

  const submitCode = async (rawCodeOrPayload: string) => {
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
      <div className="mx-auto max-w-md space-y-4 pb-10">
        <div className="cmf-chassis cmf-card-enter p-4 sm:p-5">
          <span className="cmf-badge-orange inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            SARDINEN GEFUNDEN?
          </span>
          <h2 className="font-dot mt-1 text-lg sm:text-xl text-[var(--text-main)]">
            QR-Code scannen oder Verstecker-Passwort eingeben
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Sobald der Code bestätigt ist, stoppt eure Suchzeit sofort und ihr wechselt gemeinsam in das Sardinen-Versteck!
          </p>
        </div>

        {!gameRunning && (
          <div className="cmf-badge-amber rounded-2xl p-3.5 text-xs font-medium">
            Hinweis: Ein Catch kann erst während einer laufenden Suchrunde gewertet werden.
          </div>
        )}

        {/* Kamera-Scanner */}
        <div className="cmf-module p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <span className="font-industrial text-sm text-[var(--text-main)]">
              1. Per Smartphone-Kamera scannen
            </span>
            <button
              type="button"
              disabled={!gameRunning}
              onClick={() => setCameraActive((a) => !a)}
              className={`font-dot inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold ${
                cameraActive ? 'cmf-btn-active' : 'cmf-btn-primary'
              }`}
            >
              {cameraActive ? (
                <>
                  <CameraOff className="h-4 w-4 text-[var(--nothing-red)]" /> Kamera stoppen
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" /> QR-Code scannen
                </>
              )}
            </button>
          </div>

          {cameraActive && (
            <div className="cmf-drawer-down relative overflow-hidden rounded-xl">
              <div
                id={scannerRegionId}
                className="cmf-oled overflow-hidden p-1"
              />
              <span
                aria-hidden="true"
                className="cmf-scan-line pointer-events-none absolute inset-x-3 top-2 h-0.5 rounded-full bg-[var(--cmf-orange)] shadow-[0_0_12px_#FF4D00]"
              />
            </div>
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
            2. Verstecker-Passwort / Fang-Code eingeben
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
              placeholder="Passwort / Fang-Code ..."
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
                TREFFER! Ihr seid jetzt offiziell bei den Sardinen!
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
