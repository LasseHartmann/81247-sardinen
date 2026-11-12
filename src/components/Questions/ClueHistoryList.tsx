import React from 'react';
import { Eye, EyeOff, Check, Database, Image as ImageIcon, Volume2 } from 'lucide-react';
import type { ClueRecord, ClueRequest } from '../../types/game';
import { formatDurationClock, formatPenaltyMinutes } from '../../utils/formatting';

export interface ClueHistoryListProps {
  clues: ClueRecord[];
  requestsMap: Record<string, ClueRequest>;
  hiddenClueIds: Set<string>;
  gameStartTimestamp: number | null;
  onToggleClueOverlay: (clueId: string) => void;
  onAcknowledgeMedia?: (teamId: string, requestId: string) => Promise<void>;
}

export const ClueHistoryList: React.FC<ClueHistoryListProps> = ({
  clues,
  requestsMap,
  hiddenClueIds,
  gameStartTimestamp,
  onToggleClueOverlay,
  onAcknowledgeMedia,
}) => {
  const sorted = [...clues].sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    return (
      <div className="cmf-module p-5 text-center text-xs text-[var(--text-muted)]">
        Noch keine ausgewerteten Hinweise vorhanden. Gekaufte Hinweise und deren Karten-Overlays erscheinen sofort hier.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((clue) => {
        const isHidden = hiddenClueIds.has(clue.id);
        const hasOverlay = Boolean(clue.overlayGeoJson);
        const linkedReq = requestsMap[clue.requestId];
        const mediaDataUrl = linkedReq?.mediaBase64;
        const relTimeMs =
          gameStartTimestamp !== null
            ? Math.max(0, clue.createdAt - gameStartTimestamp)
            : 0;

        return (
          <div
            key={clue.id}
            data-testid={`clue-card-${clue.questionType}`}
            className="cmf-module p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
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

            {/* Eingebettete Foto-/Audio-Wiedergabe + Speicherbereinigung */}
            {clue.hasMedia && (
              <div className="cmf-well mt-3 p-3">
                {mediaDataUrl ? (
                  <div className="space-y-2.5">
                    {clue.mediaKind === 'IMAGE' ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                          <ImageIcon className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                          Übermitteltes Verstecker-Foto (EXIF-bereinigt)
                        </div>
                        <div className="cmf-oled overflow-hidden p-1.5">
                          <img
                            src={mediaDataUrl}
                            alt={clue.title}
                            className="max-h-64 w-full rounded-lg object-contain"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                          <Volume2 className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                          10s Umgebungsgeräusche
                        </div>
                        <audio
                          controls
                          playsInline
                          src={mediaDataUrl}
                          className="w-full"
                        />
                      </div>
                    )}

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
                    Mediendatei wurde als gesehen bestätigt und speicherschonend aus der Datenbank bereinigt.
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
