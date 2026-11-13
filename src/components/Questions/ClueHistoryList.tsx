import React, { useEffect, useRef, useState } from 'react';
import {
  Clock,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Users,
} from 'lucide-react';
import { MEDIA_AUTO_EXPIRE_MS } from '../../config/gameConfig';
import type { ClueRecord, ClueRequest, TeamPublic } from '../../types/game';
import { formatDurationClock, formatPenaltyMinutes } from '../../utils/formatting';

export interface ClueHistoryListProps {
  clues: ClueRecord[];
  requestsMap: Record<string, ClueRequest>;
  hiddenClueIds: Set<string>;
  gameStartTimestamp: number | null;
  onToggleClueOverlay: (clueId: string) => void;
  getServerNow?: () => number;
  onDownloadMedia?: (teamId: string, requestId: string) => Promise<void>;
  onAcknowledgeMedia?: (teamId: string, requestId: string) => Promise<void>;
  teamsPublic?: Record<string, TeamPublic>;
  showTeamBadge?: boolean;
  emptyMessage?: string;
}

function triggerDataUrlDownload(dataUrl: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export const ClueHistoryList: React.FC<ClueHistoryListProps> = ({
  clues,
  requestsMap,
  hiddenClueIds,
  gameStartTimestamp,
  onToggleClueOverlay,
  getServerNow,
  onDownloadMedia,
  onAcknowledgeMedia,
  teamsPublic,
  showTeamBadge = false,
  emptyMessage,
}) => {
  const readClock = () => (getServerNow ? getServerNow() : Date.now());
  const [nowMs, setNowMs] = useState<number>(() => readClock());
  const expiredTriggeredRef = useRef<Set<string>>(new Set());

  const hasActiveMedia = clues.some(
    (c) => c.hasMedia && Boolean(requestsMap[c.requestId]?.mediaBase64)
  );

  useEffect(() => {
    setNowMs(readClock());
    if (!hasActiveMedia) return;
    const id = window.setInterval(() => {
      setNowMs(getServerNow ? getServerNow() : Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasActiveMedia, getServerNow]);

  // Sobald der 10-Min.- bzw. 1-Min.-Timer abgelaufen ist, Foto auch aus der DB bereinigen
  useEffect(() => {
    if (!onAcknowledgeMedia || !hasActiveMedia) return;
    for (const clue of clues) {
      if (!clue.hasMedia) continue;
      const linkedReq = requestsMap[clue.requestId];
      if (!linkedReq?.mediaBase64) continue;
      const expiresAt =
        linkedReq.mediaExpiresAt ??
        (linkedReq.processedAt ?? linkedReq.createdAt ?? clue.createdAt) +
          MEDIA_AUTO_EXPIRE_MS;
      if (nowMs >= expiresAt && !expiredTriggeredRef.current.has(clue.requestId)) {
        expiredTriggeredRef.current.add(clue.requestId);
        void onAcknowledgeMedia(clue.teamId, clue.requestId).catch(() => {
          expiredTriggeredRef.current.delete(clue.requestId);
        });
      }
    }
  }, [clues, hasActiveMedia, nowMs, onAcknowledgeMedia, requestsMap]);

  const sorted = [...clues].sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    return (
      <div className="cmf-module p-5 text-center text-xs text-[var(--text-muted)]">
        {emptyMessage ?? 'Noch keine Tipps gekauft.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((clue, idx) => {
        const isHidden = hiddenClueIds.has(clue.id);
        const hasOverlay = Boolean(clue.overlayGeoJson);
        const linkedReq = requestsMap[clue.requestId];
        const rawMediaDataUrl = linkedReq?.mediaBase64;
        const expiresAt = linkedReq
          ? (linkedReq.mediaExpiresAt ??
            (linkedReq.processedAt ?? linkedReq.createdAt ?? clue.createdAt) +
              MEDIA_AUTO_EXPIRE_MS)
          : clue.createdAt + MEDIA_AUTO_EXPIRE_MS;
        const mediaRemainingMs = Math.max(0, expiresAt - nowMs);
        const mediaVisible = Boolean(rawMediaDataUrl) && mediaRemainingMs > 0;
        const wasDownloaded = Boolean(linkedReq?.mediaDownloadedAt);

        const teamInfo = teamsPublic?.[clue.teamId];
        const isSelfie = clue.questionType === 'MEDIA_SELFIE';
        const relTimeMs =
          gameStartTimestamp !== null
            ? Math.max(0, clue.createdAt - gameStartTimestamp)
            : 0;

        return (
          <div
            key={clue.id}
            data-testid={`clue-card-${clue.questionType}`}
            style={{ animationDelay: `${Math.min(idx * 40, 200)}ms` }}
            className="cmf-module cmf-card-enter p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {showTeamBadge && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-white/85 px-2 py-0.5 font-tech text-[10px] font-bold text-[var(--text-main)] uppercase">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: teamInfo?.color ?? '#FF4D00' }}
                      />
                      {teamInfo?.name ?? clue.teamId}
                    </span>
                  )}

                  <span className="font-industrial text-sm text-[var(--text-main)]">
                    {clue.title}
                  </span>

                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      clue.penaltyMs <= 0 ? 'cmf-badge-teal' : 'cmf-badge-orange'
                    }`}
                  >
                    {clue.refundedMs && clue.refundedMs > 0
                      ? `-${Math.round(clue.refundedMs / 60000)} Min. + Gratis-Ring`
                      : clue.penaltyMs === 0
                        ? 'Gratis-Ersatz'
                        : formatPenaltyMinutes(clue.penaltyMs)}
                  </span>
                </div>

                <p className="mt-1.5 text-sm font-bold text-[var(--cmf-teal)]">
                  {clue.answerText}
                </p>
                {clue.detailText && (
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {clue.detailText}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <span className="font-tech text-[10px] font-medium text-[var(--text-muted)]">
                  @{formatDurationClock(relTimeMs)}
                </span>

                {hasOverlay && (
                  <button
                    type="button"
                    onClick={() => onToggleClueOverlay(clue.id)}
                    className={`font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase ${
                      isHidden ? 'cmf-btn-secondary' : 'cmf-btn-active'
                    }`}
                  >
                    {isHidden ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> Ausgeblendet
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5 text-[var(--cmf-teal)]" /> Auf Karte
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Eingebettete Foto-Wiedergabe mit 10-Min.-Auto-Ablauf & 1-Min.-Timer nach Download */}
            {clue.hasMedia && (
              <div className="cmf-well mt-3 p-3">
                {mediaVisible && rawMediaDataUrl ? (
                  <div className="space-y-2.5">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                          {isSelfie ? (
                            <Users className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                          ) : (
                            <ImageIcon className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                          )}
                          {isSelfie
                            ? 'Gruppen-Selfie der Verstecker'
                            : 'Übermitteltes Verstecker-Foto'}
                        </div>

                        <span
                          data-testid={`media-ttl-badge-${clue.requestId}`}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase ${
                            wasDownloaded || mediaRemainingMs <= 60_000
                              ? 'cmf-badge-orange'
                              : 'cmf-badge-amber'
                          }`}
                        >
                          <Clock className="h-3 w-3" />
                          Löscht in {formatDurationClock(mediaRemainingMs)}
                        </span>
                      </div>

                      <div className="cmf-oled overflow-hidden p-1.5">
                        <img
                          src={rawMediaDataUrl}
                          alt={clue.title}
                          className="max-h-64 w-full rounded-lg object-contain"
                        />
                      </div>
                    </div>

                    {onDownloadMedia && (
                      <button
                        type="button"
                        data-testid={`download-media-btn-${clue.requestId}`}
                        onClick={async () => {
                          const ext = linkedReq?.mediaMimeType?.includes('png')
                            ? 'png'
                            : 'jpg';
                          triggerDataUrlDownload(
                            rawMediaDataUrl,
                            `sardinen-hinweis-${clue.questionType.toLowerCase()}.${ext}`
                          );
                          await onDownloadMedia(clue.teamId, clue.requestId);
                          setNowMs(readClock());
                        }}
                        className="cmf-btn-primary font-dot inline-flex min-h-[40px] w-full items-center justify-center gap-2 px-3 py-2 text-xs font-bold"
                      >
                        <Download className="h-4 w-4" />
                        {wasDownloaded
                          ? `Erneut herunterladen (verschwindet in ${formatDurationClock(mediaRemainingMs)})`
                          : 'Foto herunterladen (verschwindet danach in 1 Min.)'}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="font-tech text-[11px] text-[var(--text-muted)]">
                    Foto ist automatisch abgelaufen und wurde aus der Ansicht & Datenbank entfernt.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
