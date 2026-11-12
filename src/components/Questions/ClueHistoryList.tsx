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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-center text-xs text-slate-400">
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
            className="rounded-2xl border border-slate-800 bg-slate-900/95 p-3.5 shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-extrabold text-white">
                    {clue.title}
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      clue.penaltyMs === 0
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-950/80 text-rose-300'
                    }`}
                  >
                    {clue.penaltyMs === 0
                      ? 'Gratis-Ersatz'
                      : formatPenaltyMinutes(clue.penaltyMs)}
                  </span>
                  {clue.usedOfflineOsmFallback && (
                    <span
                      title="Aus kuratierten 81247-Ortsdaten ausgewertet"
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-amber-300"
                    >
                      <Database className="h-3 w-3" /> 81247-Offline-Daten
                    </span>
                  )}
                </div>

                <p className="mt-1 text-sm font-black text-cyan-300">
                  {clue.answerText}
                </p>
                {clue.detailText && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {clue.detailText}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <span className="font-mono text-[10px] text-slate-500">
                  @{formatDurationClock(relTimeMs)}
                </span>

                {hasOverlay && (
                  <button
                    type="button"
                    onClick={() => onToggleClueOverlay(clue.id)}
                    className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                      isHidden
                        ? 'border-slate-700 bg-slate-800 text-slate-400'
                        : 'border-cyan-500/50 bg-cyan-950/60 text-cyan-200'
                    }`}
                  >
                    {isHidden ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> Ausgeblendet
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" /> Auf Karte
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Eingebettete Foto-/Audio-Wiedergabe + Speicherbereinigung */}
            {clue.hasMedia && (
              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
                {mediaDataUrl ? (
                  <div className="space-y-2.5">
                    {clue.mediaKind === 'IMAGE' ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
                          <ImageIcon className="h-3.5 w-3.5" /> Übermitteltes Verstecker-Foto (EXIF-bereinigt)
                        </div>
                        <img
                          src={mediaDataUrl}
                          alt={clue.title}
                          className="max-h-64 w-full rounded-lg border border-slate-800 object-contain"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
                          <Volume2 className="h-3.5 w-3.5" /> 10s Umgebungsgeräusche
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
                        className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-900/50"
                      >
                        <Check className="h-4 w-4" />
                        Gesehen / Lokal gespeichert (RTDB-Speicher bereinigen)
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
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
