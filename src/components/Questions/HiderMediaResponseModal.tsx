import React, { useRef, useState } from 'react';
import { Camera, Mic, Square, FlaskConical, XCircle, Clock } from 'lucide-react';
import { MEDIA_RESPONSE_TIMEOUT_NET_MS } from '../../config/gameConfig';
import {
  refundAndCompensateMediaRequest,
  submitHiderMediaResponse,
} from '../../hooks/useControllerEngine';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import {
  compressImageFileForClue,
  createSyntheticDemoAudio,
  createSyntheticDemoPhoto,
  startTenSecondAudioCapture,
  type ActiveAudioRecordingHandle,
} from '../../services/mediaService';
import type {
  AnchorPoint,
  ClueRequest,
  PublicGameState,
  TeamLocation,
  TeamPublic,
} from '../../types/game';
import { formatDurationClock, getQuestionLabelDe } from '../../utils/formatting';

export interface HiderMediaResponseModalProps {
  adapter: DatabaseAdapter;
  openRequests: ClueRequest[];
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  anchorPoint: AnchorPoint | null;
  publicState: PublicGameState;
  netElapsedMs: number;
}

export const HiderMediaResponseModal: React.FC<HiderMediaResponseModalProps> = ({
  adapter,
  openRequests,
  teamsPublic,
  teamLocations,
  anchorPoint,
  publicState,
  netElapsedMs,
}) => {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState<number | null>(null);
  const audioHandleRef = useRef<ActiveAudioRecordingHandle | null>(null);

  if (openRequests.length === 0 || !anchorPoint) {
    return null;
  }

  const req = openRequests[0];
  const team = teamsPublic[req.teamId];
  const isAudio = req.questionType === 'MEDIA_AUDIO';
  const deadlineNet =
    req.mediaDeadlineNetElapsedMs ??
    (req.netElapsedAtRequestMs ?? netElapsedMs) + MEDIA_RESPONSE_TIMEOUT_NET_MS;
  const remainingMs = Math.max(0, deadlineNet - netElapsedMs);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const compressed = await compressImageFileForClue(file);
      await submitHiderMediaResponse({
        adapter,
        req,
        mediaBase64: compressed.dataUrl,
        mediaMimeType: compressed.mimeType,
        mediaSynthetic: false,
        serverNowMs: adapter.getServerNow(),
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Foto-Komprimierung fehlgeschlagen.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStartAudio = async () => {
    setErrorMsg(null);
    try {
      setRecordingSeconds(0);
      const handle = await startTenSecondAudioCapture((sec) =>
        setRecordingSeconds(sec)
      );
      audioHandleRef.current = handle;
      const recorded = await handle.resultPromise;
      audioHandleRef.current = null;
      setRecordingSeconds(null);
      setBusy(true);
      await submitHiderMediaResponse({
        adapter,
        req,
        mediaBase64: recorded.dataUrl,
        mediaMimeType: recorded.mimeType,
        mediaSynthetic: false,
        serverNowMs: adapter.getServerNow(),
      });
    } catch (err) {
      audioHandleRef.current = null;
      setRecordingSeconds(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Mikrofon nicht verfügbar. Nutze unten das Demo-Audio.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStopAudioEarly = () => {
    audioHandleRef.current?.stopEarly();
  };

  const handleSendSyntheticFallback = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const media = isAudio
        ? createSyntheticDemoAudio()
        : createSyntheticDemoPhoto(
            req.questionType === 'MEDIA_SKY' ? 'SKY' : 'GROUND'
          );
      await submitHiderMediaResponse({
        adapter,
        req,
        mediaBase64: media.dataUrl,
        mediaMimeType: media.mimeType,
        mediaSynthetic: true,
        serverNowMs: adapter.getServerNow(),
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Demo-Medium fehlgeschlagen.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await refundAndCompensateMediaRequest({
        adapter,
        req,
        reasonStatus: 'REJECTED',
        rejectionReason: 'Von den Versteckern abgelehnt',
        anchorPoint,
        playArea: publicState.playArea.polygon,
        latestTeamLocation: teamLocations[req.teamId] ?? null,
        serverNowMs: adapter.getServerNow(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-16 z-[600] mx-auto max-w-lg p-3">
      <div className="rounded-2xl border-2 border-cyan-400 bg-slate-950/95 p-4 text-slate-100 shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-black tracking-wider text-cyan-300 uppercase">
              Dringende Medienanfrage ({team?.name ?? req.teamId})
            </span>
            <h3 className="text-base font-extrabold text-white">
              {getQuestionLabelDe(req.questionType)}
            </h3>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-rose-950/80 px-3 py-1.5 font-mono text-sm font-black text-rose-200">
            <Clock className="h-4 w-4 text-rose-400" />
            {formatDurationClock(remainingMs)}
          </div>
        </div>

        <p className="mt-1.5 text-xs text-slate-300">
          {isAudio
            ? 'Nimm 10 Sekunden unverfälschte Umgebungsgeräusche auf (max. 25 KB).'
            : req.questionType === 'MEDIA_SKY'
              ? 'Fotografiere senkrecht nach oben in den Himmel / das Blätterdach (EXIF-GPS wird automatisch entfernt, <= 60 KB).'
              : 'Fotografiere senkrecht nach unten auf den Bodenbelag (EXIF-GPS wird automatisch entfernt, <= 60 KB).'}
        </p>

        {errorMsg && (
          <div className="mt-2 rounded-lg border border-rose-500/50 bg-rose-950/60 p-2 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {!isAudio ? (
            <label className="flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow hover:bg-cyan-400">
              <Camera className="h-4 w-4" />
              {busy ? 'Komprimiere & sende ...' : 'Kamera öffnen / Foto auswählen'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => void handleFileChange(e)}
                className="hidden"
              />
            </label>
          ) : recordingSeconds !== null ? (
            <button
              type="button"
              onClick={handleStopAudioEarly}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-black text-white"
            >
              <Square className="h-4 w-4" />
              Aufnahme läuft ({recordingSeconds} / 10s) — Jetzt absenden
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleStartAudio()}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-40"
            >
              <Mic className="h-4 w-4" />
              10s Mikrofon-Aufnahme starten
            </button>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || recordingSeconds !== null}
              onClick={() => void handleSendSyntheticFallback()}
              className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold text-cyan-200 hover:bg-slate-800 disabled:opacity-40"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Synthetisches {isAudio ? 'Demo-Audio' : 'Demo-Foto'} senden
            </button>

            <button
              type="button"
              disabled={busy || recordingSeconds !== null}
              onClick={() => void handleReject()}
              className="inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-[11px] font-bold text-rose-200 hover:bg-rose-900/50 disabled:opacity-40"
            >
              <XCircle className="h-3.5 w-3.5" />
              Ablehnen (-5 Min.)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
