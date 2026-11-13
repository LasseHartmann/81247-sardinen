import React, { useRef, useState } from 'react';
import { Camera, Mic, Square, XCircle, Clock } from 'lucide-react';
import { MEDIA_RESPONSE_TIMEOUT_NET_MS } from '../../config/gameConfig';
import {
  refundAndCompensateMediaRequest,
  submitHiderMediaResponse,
} from '../../hooks/useControllerEngine';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import {
  compressImageFileForClue,
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
          : 'Mikrofon nicht verfügbar.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStopAudioEarly = () => {
    audioHandleRef.current?.stopEarly();
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
    <div className="cmf-sheet-up fixed inset-x-0 bottom-[calc(4.15rem+env(safe-area-inset-bottom))] z-[600] mx-auto max-w-lg px-2.5 py-2 sm:p-3">
      <div className="cmf-chassis p-4 sm:p-5 text-[var(--text-main)]">
        <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-3">
          <div>
            <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
              MEDIENANFRAGE // {team?.name ?? req.teamId}
            </span>
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              {getQuestionLabelDe(req.questionType)}
            </h3>
          </div>
          <div className="cmf-oled flex items-center gap-1.5 px-3 py-1.5 font-dot text-sm text-[var(--cmf-amber)]">
            <Clock className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
            {formatDurationClock(remainingMs)}
          </div>
        </div>

        <p className="mt-2.5 text-xs text-[var(--text-muted)]">
          {isAudio
            ? 'Nimm 10 Sekunden unverfälschte Umgebungsgeräusche auf (max. 25 KB).'
            : req.questionType === 'MEDIA_SKY'
              ? 'Fotografiere senkrecht nach oben in den Himmel / das Blätterdach (EXIF-GPS wird automatisch entfernt, <= 60 KB).'
              : 'Fotografiere senkrecht nach unten auf den Bodenbelag (EXIF-GPS wird automatisch entfernt, <= 60 KB).'}
        </p>

        {errorMsg && (
          <div className="cmf-badge-orange mt-2.5 rounded-lg p-2.5 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        <div className="mt-3.5 space-y-2">
          {!isAudio ? (
            <label className="cmf-btn-primary font-dot flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold">
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
              className="cmf-oled font-dot flex min-h-[46px] w-full items-center justify-center gap-2.5 px-4 py-2.5 text-xs font-bold text-[#F8FAFC]"
            >
              <span className="nothing-red-dot" />
              <Square className="h-3.5 w-3.5 text-[var(--nothing-red)]" />
              AUFNAHME ({recordingSeconds} / 10S) — JETZT ABSENDEN
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleStartAudio()}
              className="cmf-btn-primary font-dot flex min-h-[46px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
            >
              <Mic className="h-4 w-4" />
              10s Mikrofon-Aufnahme starten
            </button>
          )}

          <button
            type="button"
            disabled={busy || recordingSeconds !== null}
            onClick={() => void handleReject()}
            className="cmf-btn-secondary font-tech inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase"
          >
            <XCircle className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
            Anfrage ablehnen (-5 Min. Erstattung + Gratis-Donut-Ring)
          </button>
        </div>
      </div>
    </div>
  );
};
