import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Users, ShieldCheck } from 'lucide-react';
import { serializeQrPayload } from '../../services/qrService';
import type { HiderPrivateState, TeamPublic } from '../../types/game';

export interface HiderQrModalProps {
  sessionId: string;
  hiderPrivate: HiderPrivateState | null;
  teamsPublic: Record<string, TeamPublic>;
  activeTeamIds?: string[];
  sardineGroupMemberNames?: string[];
}

export const HiderQrView: React.FC<HiderQrModalProps> = ({
  sessionId,
  hiderPrivate,
  teamsPublic,
  activeTeamIds,
  sardineGroupMemberNames = [],
}) => {
  if (!hiderPrivate || !hiderPrivate.qrSecret || !hiderPrivate.shortCode) {
    return (
      <div className="cmf-drafting-bg flex h-full items-center justify-center p-6 text-center">
        <div className="cmf-module max-w-sm p-5 font-tech text-xs text-[var(--text-muted)]">
          QR-GEHEIMNIS WIRD GELADEN (ODER SPIEL NOCH IN VORBEREITUNG) ...
        </div>
      </div>
    );
  }

  const qrValue = serializeQrPayload(
    sessionId,
    hiderPrivate.qrSecret,
    hiderPrivate.shortCode
  );

  const activeSet = activeTeamIds ? new Set(activeTeamIds) : null;
  const joinedTeams = Object.values(teamsPublic).filter(
    (t) =>
      t.status === 'JOINED_SARDINES' &&
      t.memberPlayerIds.length > 0 &&
      (!activeSet || activeSet.has(t.id))
  );

  return (
    <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
      <div className="mx-auto max-w-md space-y-4 pb-10">
        <div className="cmf-chassis cmf-card-enter flex flex-col items-center p-4 sm:p-6 text-center space-y-3.5">
          <div className="cmf-badge-teal inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-[10px] font-bold tracking-wider uppercase">
            <QrCode className="h-3.5 w-3.5" />
            SARDINEN HQ // OFFIZIELLER CATCH-CODE
          </div>

          <div>
            <h2 className="font-dot text-lg sm:text-xl text-[var(--text-main)]">
              Sardinen-QR-Code zeigen
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Zeige diesen Bildschirm nur Sucher-Teams, die euch im Versteck tatsächlich physisch gefunden haben!
            </p>
          </div>

          {/* Maximaler Kontrast (Schwarz auf reinem Weiß) im gefrästen Polycarbonat-Rahmen, responsiv für kleine Smartphones */}
          <div className="cmf-pop-in w-full max-w-[232px] rounded-2xl border-2 border-[var(--shell-border)] bg-white p-4 shadow-sm">
            <QRCodeSVG
              value={qrValue}
              size={200}
              style={{ width: '100%', height: 'auto' }}
              bgColor="#ffffff"
              fgColor="#14171A"
              level="M"
              includeMargin={false}
            />
          </div>

          {/* Eingebettete schwarze OLED-Insel für Verstecker-Passwort / Fang-Code */}
          <div className="cmf-oled w-full p-4 text-center">
            <span className="font-tech block text-[10px] font-bold tracking-wider text-[#9AA4AE] uppercase">
              VERSTECKER-PASSWORT // FANG-CODE (FALLS KAMERA BLENDET)
            </span>
            <div
              data-testid="hider-short-code"
              className="font-tech mt-1.5 break-all text-2xl font-bold tracking-wider text-[var(--cmf-teal)]"
            >
              {hiderPrivate.shortCode}
            </div>
          </div>
        </div>

        <div className="cmf-module p-4 text-xs space-y-3">
          <div>
            <div className="flex items-center gap-2 border-b cmf-divider pb-2.5 font-industrial text-sm text-[var(--text-main)]">
              <Users className="h-4 w-4 text-[var(--cmf-teal)]" />
              Aktuelles Verstecker-Team ({sardineGroupMemberNames.length})
            </div>
            {sardineGroupMemberNames.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {sardineGroupMemberNames.map((memberName) => (
                  <span
                    key={memberName}
                    className="cmf-well inline-flex items-center gap-1.5 px-2.5 py-1 font-tech text-[11px] font-bold text-[var(--text-main)] uppercase"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--cmf-teal)]" />
                    {memberName}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="border-t cmf-divider pt-2.5">
            <div className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              Zu den Versteckern gewechselte Sucher-Teams ({joinedTeams.length})
            </div>
            {joinedTeams.length === 0 ? (
              <p className="mt-1.5 text-[var(--text-muted)]">
                Noch kein Sucher-Team hat den Code gescannt. Sobald ein Teammitglied scannt, wird das gesamte Team zum Verstecker-Team hinzugefügt!
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {joinedTeams.map((t) => (
                  <li
                    key={t.id}
                    className="cmf-well flex items-center gap-2 px-3 py-2 font-semibold text-[var(--text-main)]"
                  >
                    <ShieldCheck className="h-4 w-4 text-[var(--cmf-teal)]" />
                    <span>{t.name} (komplettes Team jetzt Verstecker)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
