import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Users, ShieldCheck } from 'lucide-react';
import { serializeQrPayload } from '../../services/qrService';
import type { HiderPrivateState, TeamPublic } from '../../types/game';

export interface HiderQrModalProps {
  sessionId: string;
  hiderPrivate: HiderPrivateState | null;
  teamsPublic: Record<string, TeamPublic>;
}

export const HiderQrView: React.FC<HiderQrModalProps> = ({
  sessionId,
  hiderPrivate,
  teamsPublic,
}) => {
  if (!hiderPrivate || !hiderPrivate.qrSecret || !hiderPrivate.shortCode) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 p-6 text-center text-sm text-slate-400">
        QR-Geheimnis wird geladen (oder Spiel befindet sich noch in der Vorbereitung) ...
      </div>
    );
  }

  const qrValue = serializeQrPayload(
    sessionId,
    hiderPrivate.qrSecret,
    hiderPrivate.shortCode
  );

  const joinedTeams = Object.values(teamsPublic).filter(
    (t) => t.status === 'JOINED_SARDINES'
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto flex max-w-md flex-col items-center space-y-5 pb-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/50 bg-cyan-950/60 px-3.5 py-1 text-xs font-extrabold text-cyan-300">
          <QrCode className="h-4 w-4" />
          Bei den Sardinen • Offizieller Catch-Code
        </div>

        <h2 className="text-xl font-black text-white">
          Sardinen-QR-Code zeigen
        </h2>
        <p className="text-xs text-slate-300">
          Zeige diesen Bildschirm nur Sucher-Teams, die euch im Versteck tatsächlich physisch gefunden haben!
        </p>

        {/* Maximaler Kontrast (Schwarz auf reinem Weiß) für Sonnenlicht im Freien */}
        <div className="rounded-3xl border-4 border-cyan-400 bg-white p-6 shadow-2xl">
          <QRCodeSVG
            value={qrValue}
            size={232}
            bgColor="#ffffff"
            fgColor="#000000"
            level="M"
            includeMargin={false}
          />
        </div>

        {/* Groß gedruckter 6-stelliger Ersatzcode ohne 0/O/1/I */}
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <span className="block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            6-stelliger Ersatzcode (falls Kamera blendet)
          </span>
          <div
            data-testid="hider-short-code"
            className="mt-1.5 font-mono text-3xl font-black tracking-[0.28em] text-cyan-300"
          >
            {hiderPrivate.shortCode}
          </div>
        </div>

        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left text-xs">
          <div className="flex items-center gap-2 font-bold text-emerald-300">
            <Users className="h-4 w-4" />
            Bereits im Versteck angekommene Teams ({joinedTeams.length})
          </div>
          {joinedTeams.length === 0 ? (
            <p className="mt-1.5 text-slate-400">
              Noch kein Sucher-Team hat den Code gescannt. Bleibt ruhig im 20m-Radius!
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {joinedTeams.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 font-semibold text-white"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>{t.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
