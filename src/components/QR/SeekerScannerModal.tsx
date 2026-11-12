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

  // Abonniere Rückmeldung unserer eingereichten Catch-Anfrage
  useEffect(() => {
    if (!activeRequestId) return;
    return adapter.subscribeOwnCatchRequest(activeRequestId, setWatchedCatch);
  }, [adapter, activeRequestId]);

  // Sauberer Kamera-Cleanup beim Schließen oder Komponenten-Unmount!
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
            'Kamera konnte nicht geöffnet werden. Bitte nutze unten die manuelle Eingabe des 6-stelligen Ersatzcodes.'
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
      <div className="flex h-full items-center justify-center bg-slate-950 p-6 text-center text-sm text-slate-400">
        Du bist aktuell keinem Sucher-Team zugewiesen.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-md space-y-5 pb-10">
        <div>
          <span className="text-xs font-extrabold tracking-wider text-amber-400 uppercase">
            Sardinen gefunden?
          </span>
          <h2 className="text-xl font-black text-white">
            QR-Code scannen oder 6-stelligen Code eingeben
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Sobald der Code bestätigt ist, stoppt eure Suchzeit sofort und ihr wechselt gemeinsam in das Sardinen-Versteck!
          </p>
        </div>

        {!gameRunning && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3 text-xs text-amber-200">
            Hinweis: Ein Catch kann erst während einer laufenden Suchrunde gewertet werden.
          </div>
        )}

        {/* Kamera-Scanner */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">
              1. Per Smartphone-Kamera scannen
            </span>
            <button
              type="button"
              disabled={!gameRunning}
              onClick={() => setCameraActive((a) => !a)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition disabled:opacity-40 ${
                cameraActive
                  ? 'bg-rose-600 text-white'
                  : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
              }`}
            >
              {cameraActive ? (
                <>
                  <CameraOff className="h-4 w-4" /> Kamera stoppen
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" /> QR-Code scannen
                </>
              )}
            </button>
          </div>

          {cameraActive && (
            <div
              id={scannerRegionId}
              className="overflow-hidden rounded-xl border border-cyan-500/50 bg-black"
            />
          )}

          {cameraError && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-950/50 p-2.5 text-xs text-amber-200">
              {cameraError}
            </p>
          )}
        </div>

        {/* Manuelle 6-stellige Code-Eingabe */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode(manualCode);
          }}
          className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3"
        >
          <label
            htmlFor="manual-short-code"
            className="flex items-center gap-2 text-sm font-bold text-white"
          >
            <KeyRound className="h-4 w-4 text-amber-400" />
            2. 6-stelligen Ersatzcode eingeben
          </label>
          <div className="flex gap-2">
            <input
              id="manual-short-code"
              data-testid="manual-catch-code-input"
              type="text"
              maxLength={12}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="z. B. A7K9M2"
              className="min-h-[48px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 font-mono text-lg font-black tracking-widest text-white uppercase placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
            />
            <button
              type="submit"
              data-testid="submit-catch-code-btn"
              disabled={!gameRunning || manualCode.trim().length < 4}
              className="min-h-[48px] rounded-xl bg-emerald-500 px-5 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              Prüfen
            </button>
          </div>
        </form>

        {/* Live-Statusanzeige der Prüfung */}
        {watchedCatch && (
          <div
            data-testid="catch-feedback-box"
            className={`rounded-2xl border p-4 text-xs font-semibold ${
              watchedCatch.status === 'ACCEPTED'
                ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                : watchedCatch.status === 'INVALID'
                  ? 'border-rose-500 bg-rose-950/60 text-rose-200'
                  : 'border-cyan-500/40 bg-cyan-950/40 text-cyan-200'
            }`}
          >
            {watchedCatch.status === 'PENDING' ||
            watchedCatch.status === 'PROCESSING' ? (
              <span>Code wird vom Controller-Gerät geprüft ...</span>
            ) : watchedCatch.status === 'ACCEPTED' ? (
              <span className="flex items-center gap-2 text-sm font-extrabold">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                TREFFER! Ihr seid jetzt offiziell bei den Sardinen!
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                Ungültiger Code: {watchedCatch.errorMessage ?? 'Bitte erneut prüfen.'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
