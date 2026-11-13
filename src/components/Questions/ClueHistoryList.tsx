import React from 'react';
import { Eye, EyeOff, Check, Database, Image as ImageIcon, Users } from 'lucide-react';
import type { ClueRecord, ClueRequest, TeamPublic } from '../../types/game';
import { formatDurationClock, formatPenaltyMinutes } from '../../utils/formatting';

export interface ClueHistoryListProps {
  clues: ClueRecord[];
  requestsMap: Record<string, ClueRequest>;
  hiddenClueIds: Set<string>;
  gameStartTimestamp: number | null;
  onToggleClueOverlay: (clueId: string) => void;
  onAcknowledgeMedia?: (teamId: string, requestId: string) => Promise<void>;
  teamsPublic?: Record<string, TeamPublic>;
  showTeamBadge?: boolean;
  emptyMessage?: string;
}

export const ClueHistoryList: React.FC<ClueHistoryListProps> = ({
  clues,
  requestsMap,
  hiddenClueIds,
  gameStartTimestamp,
  onToggleClueOverlay,
  onAcknowledgeMedia,
  teamsPublic,
  showTeamBadge = false,
  emptyMessage,
}) => {
  const sorted = [...clues].sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    return (
      <div className="cmf-module p-5 text-center text-xs text-[var(--text-muted)]">
        {emptyMessage ??
          'Noch keine ausgewerteten Hinweise vorhanden. Gekaufte Hinweise und deren Karten-Overlays erscheinen sofort hier.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((clue, idx) => {
        const isHidden = hiddenClueIds.has(clue.id);
        const hasOverlay = Boolean(clue.overlayGeoJson);
        const linkedReq = requestsMap[clue.requestId];
        const mediaDataUrl = linkedReq?.mediaBase64;
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
                      clue.penaltyMs === 0 ? 'cmf-badge-teal' : 'cmf-badge-orange'
                    }`}
                  >
                    {clue.penaltyMs === 0
                      ? 'Gratis-Ersatz'
                      : formatPenaltyMinutes(clue.penaltyMs)}
                  </span>

                  {clue.usedOfflineOsmFallback && (
                    <span
                      title="Aus kuratierten 81247-Ortsdaten ausgewertet"
                      className="cmf-badge-amber inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    >
                      <Database className="h-3 w-3" /> 81247-OSM
                    </span>
                  )}
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

            {/* Eingebettete Foto-Wiedergabe + Speicherbereinigung */}
            {clue.hasMedia && (
              <div className="cmf-well mt-3 p-3">
                {mediaDataUrl ? (
                  <div className="space-y-2.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                        {isSelfie ? (
                          <Users className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                        )}
                        {isSelfie
                          ? 'Gruppen-Selfie der Verstecker (alle Köpfe, EXIF-bereinigt)'
                          : 'Übermitteltes Verstecker-Foto (EXIF-bereinigt)'}
                      </div>
                      <div className="cmf-oled overflow-hidden p-1.5">
                        <img
                          src={mediaDataUrl}
                          alt={clue.title}
                          className="max-h-64 w-full rounded-lg object-contain"
                        />
                      </div>
                    </div>

                    {onAcknowledgeMedia && (
                      <button
                        type="button"
                        onClick={() =>
                          void onAcknowledgeMedia(clue.teamId, clue.requestId)
                        }
                        className="cmf-btn-active font-tech inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
                      >
                        <Check className="h-4 w-4 text-[var(--cmf-teal)]" />
                        Gesehen / Lokal gespeichert (Speicher bereinigen)
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="font-tech text-[11px] text-[var(--text-muted)]">
                    Foto wurde vom Sucher-Team als gesehen bestätigt und speicherschonend aus der Datenbank bereinigt.
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
