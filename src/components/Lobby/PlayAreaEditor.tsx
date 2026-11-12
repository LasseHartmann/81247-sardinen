import React from 'react';
import { CheckCircle2, Edit3, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import type { Feature, Polygon } from 'geojson';
import { DEFAULT_PLAY_AREA_FEATURE } from '../../config/gameConfig';
import {
  buildPolygonFromVertices,
  extractPolygonVertices,
  isValidPlayAreaPolygon,
} from '../../geo/boundary';
import type { LatLng, PlayAreaState } from '../../types/game';

export interface PlayAreaEditorProps {
  playArea: PlayAreaState;
  editActive: boolean;
  deleteVertexMode: boolean;
  onToggleEdit: (active: boolean) => void;
  onToggleDeleteVertexMode: (deleteMode: boolean) => void;
  onUpdatePolygon: (nextPoly: Feature<Polygon>, confirmed: boolean) => Promise<void>;
}

export const PlayAreaEditor: React.FC<PlayAreaEditorProps> = ({
  playArea,
  editActive,
  deleteVertexMode,
  onToggleEdit,
  onToggleDeleteVertexMode,
  onUpdatePolygon,
}) => {
  const vertices = extractPolygonVertices(playArea.polygon);
  const validation = isValidPlayAreaPolygon(playArea.polygon);

  const handleResetStandard81247 = async () => {
    await onUpdatePolygon(structuredClone(DEFAULT_PLAY_AREA_FEATURE), false);
  };

  const handleConfirm = async () => {
    if (!validation.valid) return;
    onToggleEdit(false);
    onToggleDeleteVertexMode(false);
    await onUpdatePolygon(playArea.polygon, true);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-100">
            Spielgebiet 81247 München ({vertices.length} Eckpunkte)
          </h3>
          <p className="text-xs text-slate-400">
            Obermenzing • Schloss Blutenburg • Pipping • Würm-Grünzug
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
            playArea.confirmed
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
          }`}
        >
          {playArea.confirmed ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" /> Bestätigt
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5" /> Unbestätigt
            </>
          )}
        </span>
      </div>

      {!validation.valid && (
        <div className="mt-2 rounded-lg border border-rose-500/50 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">
          Geometrie-Hinweis: {validation.reason}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onToggleEdit(!editActive);
            if (editActive) onToggleDeleteVertexMode(false);
          }}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
            editActive
              ? 'bg-cyan-500 text-slate-950'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          <Edit3 className="h-4 w-4" />
          {editActive ? 'Editor auf Karte beenden' : 'Eckpunkte auf Karte bearbeiten'}
        </button>

        {editActive && (
          <button
            type="button"
            disabled={vertices.length <= 3}
            onClick={() => onToggleDeleteVertexMode(!deleteVertexMode)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-40 ${
              deleteVertexMode
                ? 'bg-rose-500 text-white'
                : 'bg-slate-800 text-rose-300 hover:bg-slate-700'
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {deleteVertexMode ? 'Löschmodus aktiv (Punkt tippen)' : 'Eckpunkt löschen'}
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleResetStandard81247()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          <RotateCcw className="h-4 w-4" />
          81247-Standardpolygon laden
        </button>

        <button
          type="button"
          disabled={!validation.valid}
          onClick={() => void handleConfirm()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-40"
        >
          <CheckCircle2 className="h-4 w-4" />
          Spielgebiet für 81247 bestätigen
        </button>
      </div>

      {editActive && (
        <p className="mt-2 text-[11px] text-cyan-300">
          Tipp: Ziehe nummerierte Punkte auf der Karte im Hintergrund oder tippe auf „+", um neue Zwischenpunkte entlang der Grenze einzufügen.
        </p>
      )}
    </div>
  );
};

export function applyEditedVerticesToPolygon(
  nextVertices: LatLng[]
): Feature<Polygon> {
  return buildPolygonFromVertices(nextVertices);
}
