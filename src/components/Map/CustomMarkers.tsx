import L from 'leaflet';
import {
  parseSardineAvatar,
  renderCompleteSardineSvgString,
} from '../../config/sardineAvatar';
import type { TeamMemberMapMarker } from '../../services/databaseAdapter';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Eigene Position — Aktiver CMF-Signal-Orange Fokus-Punkt (#FF4D00).
 */
export function createOwnPositionIcon(_isHider: boolean): L.DivIcon {
  const coreColor = '#D71921';
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `
      <div style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
        <span style="width:15px;height:15px;border-radius:9999px;background:${coreColor};border:2.5px solid #FFFFFF;box-shadow:0 3px 10px rgba(11,12,14,0.4);"></span>
      </div>
    `,
  });
}

/**
 * Geheimer Anchor-Point-Marker („Sardinen-Versteck") — Nothing Crimson Red Pin (#D71921).
 */
export function createAnchorPointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `
      <div class="cmf-hq-glow" style="width:40px;height:40px;margin:1px;border-radius:9999px;background:#0B0C0E;border:2.5px solid #FFFFFF;display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;letter-spacing:0.04em;">
        <span style="width:7px;height:7px;border-radius:9999px;background:#D71921;margin-right:3px;display:inline-block;"></span>ZIEL
      </div>
    `,
  });
}

/**
 * Individueller Teammitglied-Marker auf der Karte (ohne Team-Logo / Sardinenbüchse):
 * Zeigt die letzte Position jedes aktiven Teammitglieds direkt als dessen eigenen Fisch
 * zusammen mit seinem Teamnamen und seiner Teamfarbe.
 */
export function createTeamMemberFishIcon(
  member: Pick<
    TeamMemberMapMarker,
    | 'playerId'
    | 'playerName'
    | 'avatar'
    | 'teamName'
    | 'teamColor'
    | 'isOnlineNow'
    | 'offsetPxX'
    | 'offsetPxY'
  >
): L.DivIcon {
  const shortTeam = escapeHtml(
    member.teamName.replace(/\s*\(.*\)/, '').trim().toUpperCase()
  );
  const safePlayer = escapeHtml(member.playerName.trim());
  const color = member.teamColor || '#00A896';
  const cfg = parseSardineAvatar(member.avatar, {
    playerId: member.playerId,
    name: member.playerName,
  });
  const fishSvg = renderCompleteSardineSvgString(cfg, 36);

  const iconWidth = 128;
  const iconHeight = 64;
  const offX = member.offsetPxX ?? 0;
  const offY = member.offsetPxY ?? 0;
  const opacityStyle = member.isOnlineNow ? '1' : '0.88';

  return L.divIcon({
    className: 'sardinen-div-icon sardinen-member-fish-icon',
    iconSize: [iconWidth, iconHeight],
    iconAnchor: [Math.round(iconWidth / 2) - offX, iconHeight - 5 - offY],
    popupAnchor: [offX, -(iconHeight - 10) + offY],
    html: `
      <div style="width:${iconWidth}px;height:${iconHeight}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;pointer-events:auto;opacity:${opacityStyle};">
        <!-- Spielername + Team-Abzeichen -->
        <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;margin-bottom:2px;border-radius:9999px;background:#FFFFFF;border:1.5px solid ${color};color:#171717;font-family:'Inter',sans-serif;font-size:9.5px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(15,23,42,0.18);">
          <span style="width:6px;height:6px;border-radius:9999px;background:${color};display:inline-block;flex-shrink:0;"></span>
          <span>${safePlayer}</span>
          <span style="opacity:0.45;">·</span>
          <span style="color:${color};font-weight:800;">${shortTeam}</span>
        </div>

        <!-- Eigener Fisch des Teammitglieds im Teamfarben-Rahmen -->
        <div title="${safePlayer} (${shortTeam})" style="height:32px;padding:1px 6px;border-radius:9999px;background:#FFFFFF;border:2px solid ${color};box-shadow:0 3px 10px rgba(15,23,42,0.22);display:inline-flex;align-items:center;justify-content:center;">
          ${fishSvg}
        </div>

        <!-- Präziser GPS-Ankerpunkt in Teamfarbe -->
        <div style="width:9px;height:9px;border-radius:9999px;background:${color};border:2px solid #FFFFFF;margin-top:2px;box-shadow:0 2px 5px rgba(15,23,42,0.3);"></div>
      </div>
    `,
  });
}

export function renderTeamMemberFishPopupHtml(params: {
  playerId: string;
  playerName: string;
  avatar?: string;
  teamName: string;
  teamColor: string;
  accuracyMeters: number;
  isOnlineNow: boolean;
  lastOnlineAt: number;
  nowMs: number;
}): string {
  const {
    playerId,
    playerName,
    avatar,
    teamName,
    teamColor,
    accuracyMeters,
    isOnlineNow,
    lastOnlineAt,
    nowMs,
  } = params;
  const cfg = parseSardineAvatar(avatar, { playerId, name: playerName });
  const ageMinutes = Math.max(0, Math.round((nowMs - lastOnlineAt) / 60_000));
  const statusText = isOnlineNow
    ? 'Live online'
    : ageMinutes <= 1
      ? 'Zuletzt online vor ~1 Min.'
      : `Zuletzt online vor ${ageMinutes} Min.`;

  return `<div style="min-width:148px;"><div style="display:flex;align-items:center;gap:6px;">${renderCompleteSardineSvgString(cfg, 24)}<div><div style="font-weight:800;color:#0F172A;line-height:1.15;">${escapeHtml(playerName)}</div><div style="display:flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;color:#334155;margin-top:1px;"><span style="width:7px;height:7px;border-radius:9999px;background:${teamColor};display:inline-block;"></span><span>${escapeHtml(teamName)}</span></div></div></div><div style="font-size:11px;color:#475569;margin-top:5px;">${escapeHtml(statusText)} • GPS: ±${Math.round(accuracyMeters)} m</div></div>`;
}

/**
 * Auswahl-Pin für Kartenteiler- oder Thermometer-Punkte (#FF4D00 primär / #14171A sekundär).
 */
export function createSelectionPinIcon(
  label: string,
  variant: 'primary' | 'secondary' = 'primary'
): L.DivIcon {
  const safe = escapeHtml(label);
  const isPrimary = variant === 'primary';
  const bg = isPrimary ? '#D71921' : '#0B0C0E';
  const border = '2.5px solid #FFFFFF';
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `
      <div style="width:30px;height:30px;border-radius:9999px;background:${bg};border:${border};color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(11,12,14,0.32);">
        ${safe}
      </div>
    `,
  });
}

/**
 * Hochsichtbarer Notfall-SOS-Marker (#DC2626 / #991B1B) mit konzentrischer Alarmwelle.
 */
export function createEmergencyBeaconIcon(senderName: string): L.DivIcon {
  const safeName = escapeHtml(senderName);
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [132, 52],
    iconAnchor: [66, 38],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9999px;background:#991B1B;border:2px solid #FCA5A5;color:#FFFFFF;font-family:'Inter',sans-serif;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 14px rgba(220,38,38,0.45);">
          <span style="width:7px;height:7px;border-radius:9999px;background:#FFFFFF;display:inline-block;"></span>
          <span>Notfall · ${safeName}</span>
        </div>
        <div style="position:relative;width:22px;height:22px;margin-top:1px;display:flex;align-items:center;justify-content:center;">
          <span class="cmf-sos-wave" style="position:absolute;inset:0;border-radius:9999px;background:rgba(220,38,38,0.58);pointer-events:none;"></span>
          <span style="position:relative;width:14px;height:14px;border-radius:9999px;background:#DC2626;border:2.5px solid #FFFFFF;box-shadow:0 0 12px rgba(220,38,38,0.7);"></span>
        </div>
      </div>
    `,
  });
}

/**
 * Manhunt Verstecker-Ping-Marker (#FF4D00 bzw. #F59E0B bei GPS-Fallback).
 */
export function createManhuntPingIcon(
  pingNumber: number,
  isFallbackSource = false
): L.DivIcon {
  const badgeBg = isFallbackSource ? '#52565E' : '#0B0C0E';
  const dotBg = isFallbackSource ? '#52565E' : '#D71921';
  const label = isFallbackSource
    ? `Ping #${pingNumber} (Fallback)`
    : `Ping #${pingNumber}`;
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [148, 48],
    iconAnchor: [74, 36],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:9999px;background:${badgeBg};border:1.5px solid #FFFFFF;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(11,12,14,0.32);">
          <span style="width:6px;height:6px;border-radius:9999px;background:#D71921;display:inline-block;"></span>
          <span>${escapeHtml(label)}</span>
        </div>
        <div style="position:relative;width:20px;height:20px;margin-top:2px;display:flex;align-items:center;justify-content:center;">
          <span style="width:13px;height:13px;border-radius:9999px;background:${dotBg};border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></span>
        </div>
      </div>
    `,
  });
}

/**
 * Freigegebener Live-Verstecker-Standort nach >2 Min. Zonen-/Bereichsverstoß (#DC2626).
 */
export function createExposedHiderIcon(): L.DivIcon {
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [176, 52],
    iconAnchor: [88, 38],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9999px;background:#DC2626;border:2px solid #FFFFFF;color:#FFFFFF;font-family:'Inter',sans-serif;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 14px rgba(220,38,38,0.45);">
          <span style="width:7px;height:7px;border-radius:9999px;background:#FFFFFF;display:inline-block;"></span>
          <span>Verstecker (Live)</span>
        </div>
        <div style="position:relative;width:22px;height:22px;margin-top:1px;display:flex;align-items:center;justify-content:center;">
          <span class="cmf-sos-wave" style="position:absolute;inset:0;border-radius:9999px;background:rgba(220,38,38,0.58);pointer-events:none;"></span>
          <span style="position:relative;width:14px;height:14px;border-radius:9999px;background:#DC2626;border:2.5px solid #FFFFFF;box-shadow:0 0 12px rgba(220,38,38,0.7);"></span>
        </div>
      </div>
    `,
  });
}

/**
 * Live-Verstecker-Pin für Overview-Account & Sardinen-Rudel im Manhunt-Modus (#FF4D00).
 */
export function createLiveHiderOverviewIcon(label = 'Verstecker'): L.DivIcon {
  const safe = escapeHtml(label);
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [120, 40],
    iconAnchor: [60, 28],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:9999px;background:#0B0C0E;border:1.5px solid #FFFFFF;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 3px 10px rgba(11,12,14,0.32);">
          <span style="width:6px;height:6px;border-radius:9999px;background:#D71921;display:inline-block;"></span>
          <span>${safe}</span>
        </div>
        <div style="width:11px;height:11px;border-radius:9999px;background:#D71921;border:2px solid #FFFFFF;margin-top:2px;box-shadow:0 2px 6px rgba(0,0,0,0.28);"></div>
      </div>
    `,
  });
}
