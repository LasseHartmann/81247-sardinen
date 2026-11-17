import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  ChevronDown,
  ChevronUp,
  Clock,
  Image as ImageIcon,
  Users,
  XCircle,
  Zap,
  ZapOff,
} from 'lucide-react';
import {
  getMediaRefundMs,
  MEDIA_RESPONSE_TIMEOUT_NET_MS,
} from '../../config/gameConfig';
import {
  refundAndCompensateMediaRequest,
  submitHiderMediaResponse,
} from '../../hooks/useControllerEngine';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import { compressImageFileForClue } from '../../services/mediaService';
import type {
  AnchorPoint,
  ClueRequest,
  PublicGameState,
  TeamLocation,
  TeamPublic,
} from '../../types/game';
import { formatDurationClock, getQuestionLabelDe } from '../../utils/formatting';
import { PhysicsBottomSheet } from '../Common/PhysicsBottomSheet';

export interface HiderMediaResponseModalProps {
  adapter: DatabaseAdapter;
  openRequests: ClueRequest[];
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  anchorPoint: AnchorPoint | null;
  publicState: PublicGameState;
  netElapsedMs: number;
  sardineGroupMemberNames: string[];
}

type TorchCapableTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
};

async function applyHardwareTorchIfSupported(
  stream: MediaStream | null,
  enabled: boolean
): Promise<boolean> {
  if (!stream) return false;
  const track = stream.getVideoTracks()[0] as TorchCapableTrack | undefined;
  if (!track || typeof track.applyConstraints !== 'function') return false;
  try {
    const caps = track.getCapabilities?.();
    if (caps && 'torch' in caps && !caps.torch) {
      return false;
    }
    await track.applyConstraints({
      advanced: [{ torch: enabled } as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}

export const HiderMediaResponseModal: React.FC<HiderMediaResponseModalProps> = ({
  adapter,
  openRequests,
  teamsPublic,
  teamLocations,
  anchorPoint,
  publicState,
  netElapsedMs,
  sardineGroupMemberNames,
}) => {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [screenFlashActive, setScreenFlashActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCameraStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      void applyHardwareTorchIfSupported(stream, false);
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignorieren
        }
      }
    }
    const videoEl = videoRef.current;
    if (videoEl && videoEl.srcObject) {
      try {
        videoEl.pause();
      } catch {
        // Ignorieren
      }
      videoEl.srcObject = null;
    }
    setCameraOpen(false);
    setCameraStarting(false);
    setScreenFlashActive(false);
  }, []);

  const activeRequestId = openRequests[0]?.id ?? null;
  useEffect(() => {
    setCollapsed(false);
    stopCameraStream();
  }, [activeRequestId, stopCameraStream]);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  if (openRequests.length === 0 || !anchorPoint) {
    return null;
  }

  const req = openRequests[0];
  const team = teamsPublic[req.teamId];
  const isSelfie = req.questionType === 'MEDIA_SELFIE';
  const refundMs =
    req.penaltyMs > 0
      ? req.penaltyMs * 2
      : getMediaRefundMs(
          publicState.classicSearchDurationMs,
          publicState.questionConfig
        );
  const refundMin = Math.round(refundMs / 60_000);
  const deadlineNet =
    req.mediaDeadlineNetElapsedMs ??
    (req.netElapsedAtRequestMs ?? netElapsedMs) + MEDIA_RESPONSE_TIMEOUT_NET_MS;
  const remainingMs = Math.max(0, deadlineNet - netElapsedMs);

  const handleToggleFlash = async () => {
    const nextFlash = !flashEnabled;
    setFlashEnabled(nextFlash);
    if (streamRef.current) {
      await applyHardwareTorchIfSupported(streamRef.current, nextFlash);
    }
  };

  const handleOpenLiveCamera = async () => {
    if (cameraOpen || cameraStarting) {
      stopCameraStream();
      return;
    }
    setErrorMsg(null);
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setErrorMsg(
        'Direkte Kamera im Browser nicht verfügbar – nutze unten „Foto auswählen / System-Kamera“.'
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
            facingMode: { ideal: isSelfie ? 'user' : 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      streamRef.current = stream;
      setCameraOpen(true);
      setCameraStarting(false);

      if (flashEnabled) {
        await applyHardwareTorchIfSupported(stream, true);
      }

      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.setAttribute('playsinline', 'true');
        videoEl.muted = true;
        await videoEl.play().catch(() => {});
      }
    } catch {
      stopCameraStream();
      setErrorMsg(
        'Kamerazugriff nicht möglich – nutze bitte unten „Foto auswählen / System-Kamera“.'
      );
    }
  };

  const handleCaptureFromLiveCamera = async () => {
    const videoEl = videoRef.current;
    if (!videoEl || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      if (flashEnabled) {
        await applyHardwareTorchIfSupported(streamRef.current, true);
        setScreenFlashActive(true);
        await new Promise((r) => setTimeout(r, 260));
      }

      const vw = Math.max(320, videoEl.videoWidth || 640);
      const vh = Math.max(240, videoEl.videoHeight || 480);
      const canvas = document.createElement('canvas');
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Kamera-Bild konnte nicht verarbeitet werden.');
      }
      ctx.drawImage(videoEl, 0, 0, vw, vh);
      setScreenFlashActive(false);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9)
      );
      if (!blob) {
        throw new Error('Foto konnte nicht aufgenommen werden.');
      }

      const rawFile = new File([blob], 'hider-photo.jpg', {
        type: 'image/jpeg',
      });
      const compressed = await compressImageFileForClue(rawFile);
      stopCameraStream();

      await submitHiderMediaResponse({
        adapter,
        req,
        mediaBase64: compressed.dataUrl,
        mediaMimeType: compressed.mimeType,
        mediaSynthetic: false,
        serverNowMs: adapter.getServerNow(),
      });
    } catch (err) {
      setScreenFlashActive(false);
      setErrorMsg(
        err instanceof Error ? err.message : 'Foto-Aufnahme fehlgeschlagen.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      if (flashEnabled) {
        setScreenFlashActive(true);
        await new Promise((r) => setTimeout(r, 180));
        setScreenFlashActive(false);
      }
      const compressed = await compressImageFileForClue(file);
      stopCameraStream();
      await submitHiderMediaResponse({
        adapter,
        req,
        mediaBase64: compressed.dataUrl,
        mediaMimeType: compressed.mimeType,
        mediaSynthetic: false,
        serverNowMs: adapter.getServerNow(),
      });
    } catch (err) {
      setScreenFlashActive(false);
      setErrorMsg(
        err instanceof Error ? err.message : 'Foto-Komprimierung fehlgeschlagen.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    setErrorMsg(null);
    stopCameraStream();
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
    <>
      {screenFlashActive && (
        <div
          data-testid="camera-screen-flash-overlay"
          className="pointer-events-none fixed inset-0 z-[9999] bg-white transition-opacity duration-150"
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.15rem+env(safe-area-inset-bottom))] z-[600] mx-auto max-w-lg px-2.5 py-2 sm:p-3">
        <PhysicsBottomSheet
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          allowBodyDrag={!cameraOpen}
          maxWidthClass="max-w-lg"
          sheetClassName="text-[var(--text-main)]"
          bodyClassName="p-4 pt-3 sm:p-5 sm:pt-3.5"
          header={
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-tech block truncate text-[10px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
                  FOTO-ANFRAGE // {team?.name ?? req.teamId}
                </span>
                <h3 className="font-industrial truncate text-base text-[var(--text-main)]">
                  {getQuestionLabelDe(req.questionType)}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="cmf-oled flex items-center gap-1.5 px-3 py-1.5 font-dot text-sm text-[var(--cmf-amber)]">
                  <Clock className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  {formatDurationClock(remainingMs)}
                </div>
                {collapsed ? (
                  <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                )}
              </div>
            </div>
          }
        >
          {isSelfie ? (
            <div className="cmf-well space-y-1.5 border border-[var(--cmf-orange)]/45 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-tech text-[11px] font-bold text-[var(--cmf-orange)] uppercase">
                <Users className="h-4 w-4 shrink-0" />
                Pflichtregel Gruppen-Selfie:
              </p>
              <p className="font-semibold text-[var(--text-main)]">
                Der komplette Kopf jedes Mitglieds eurer aktuellen Verstecker-Gruppe muss vollständig auf dem Foto zu sehen sein!
              </p>
              {sardineGroupMemberNames.length > 0 && (
                <p className="font-tech text-[10px] text-[var(--text-muted)] uppercase">
                  Im Bild ({sardineGroupMemberNames.length}):{' '}
                  <span className="font-bold text-[var(--text-main)]">
                    {sardineGroupMemberNames.join(', ')}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              {req.questionType === 'MEDIA_SKY'
                ? 'Mach ein Foto gerade nach oben.'
                : 'Mach ein Foto gerade nach unten auf den Boden.'}
            </p>
          )}

          {/* Kamera-Blitz Schalter (LED-Torch + Display-Blitz) */}
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-[var(--shell-border)] bg-[var(--surface-inset)] px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              {flashEnabled ? (
                <Zap className="h-4 w-4 shrink-0 text-[var(--cmf-amber)]" />
              ) : (
                <ZapOff className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="font-tech text-[11px] font-bold text-[var(--text-main)] uppercase">
                Kamera-Blitz
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={flashEnabled}
              data-testid="hider-camera-flash-toggle"
              onClick={() => void handleToggleFlash()}
              className={`font-tech inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 py-1 text-[11px] font-bold uppercase transition-all ${
                flashEnabled ? 'cmf-btn-active' : 'cmf-btn-secondary'
              }`}
            >
              {flashEnabled ? (
                <>
                  <Zap className="h-3.5 w-3.5 text-[var(--cmf-amber)]" />
                  <span>Blitz: AN</span>
                </>
              ) : (
                <>
                  <ZapOff className="h-3.5 w-3.5" />
                  <span>Blitz: AUS</span>
                </>
              )}
            </button>
          </div>

          {/* Eingebettete Live-Kamera-Vorschau */}
          <div
            className={`mt-2.5 overflow-hidden rounded-2xl ${
              cameraOpen ? 'block space-y-2' : 'hidden'
            }`}
          >
            <div className="cmf-oled relative aspect-video max-h-[240px] w-full overflow-hidden p-1">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-full w-full rounded-xl object-cover"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                data-testid="capture-hider-photo-btn"
                disabled={busy}
                onClick={() => void handleCaptureFromLiveCamera()}
                className="cmf-btn-primary font-dot flex min-h-[44px] flex-1 items-center justify-center gap-2 px-4 py-2 text-xs font-bold"
              >
                <Camera className="h-4 w-4" />
                <span>{busy ? 'Sende Foto ...' : 'Foto jetzt auslösen'}</span>
              </button>
              <button
                type="button"
                onClick={() => stopCameraStream()}
                className="cmf-btn-secondary font-tech inline-flex min-h-[44px] items-center gap-1 px-3 py-2 text-[11px] font-bold uppercase"
              >
                <CameraOff className="h-4 w-4 text-[var(--nothing-red)]" />
                <span>Stopp</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="cmf-badge-orange mt-2.5 rounded-lg p-2.5 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <div className="mt-3 space-y-2">
            {!cameraOpen && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  data-testid="open-hider-camera-btn"
                  disabled={busy || cameraStarting}
                  onClick={() => void handleOpenLiveCamera()}
                  className="cmf-btn-primary font-dot flex min-h-[46px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
                >
                  <Camera className="h-4 w-4" />
                  <span>
                    {cameraStarting ? 'Kamera startet ...' : 'Kamera öffnen'}
                  </span>
                </button>

                <label className="cmf-btn-secondary font-tech flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 px-3.5 py-2.5 text-[11px] font-bold text-[var(--text-main)] uppercase">
                  <ImageIcon className="h-4 w-4 text-[var(--cmf-teal)]" />
                  <span>
                    {busy ? 'Sende Foto ...' : 'Foto auswählen / System-Kamera'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture={isSelfie ? 'user' : 'environment'}
                    disabled={busy}
                    onChange={(e) => void handleFileChange(e)}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleReject()}
              className="cmf-btn-secondary font-tech inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase"
            >
              <XCircle className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
              Ablehnen (-{refundMin} Min. für Sucher)
            </button>
          </div>
        </PhysicsBottomSheet>
      </div>
    </>
  );
};
