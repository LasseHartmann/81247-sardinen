import L from 'leaflet';
import {
  DEFAULT_SARDINE_AVATAR,
  parseSardineAvatar,
  renderCompleteSardineSvgString,
} from '../../config/sardineAvatar';

export interface OnlineTeamMemberBadge {
  playerId: string;
  name: string;
  avatar?: string;
}

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
  const coreColor = '#FF4D00';
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `
      <div style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
        <span style="width:15px;height:15px;border-radius:9999px;background:${coreColor};border:2.5px solid #FFFFFF;box-shadow:0 3px 10px rgba(20,25,30,0.35);"></span>
      </div>
    `,
  });
}

/**
 * Geheimer Anchor-Point-Marker („Sardinen-Versteck") — Primärer Hardware-Pin in #FF4D00 mit sanftem HQ-Puls.
 */
export function createAnchorPointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `
      <div class="cmf-hq-glow" style="width:40px;height:40px;margin:1px;border-radius:9999px;background:#FF4D00;border:2.5px solid #FFFFFF;display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;letter-spacing:0.04em;">
        HQ
      </div>
    `,
  });
}

/**
 * Team-Beacon-Marker als geöffnete Sardinenbüchse (Sardines Tin) mit allen aktuell
 * online befindlichen Team-Mitgliedern als individuelle Sardinen im Inneren der Dose.
 */
export function createTeamBeaconIcon(
  teamName: string,
  color: string,
  onlineMembers: OnlineTeamMemberBadge[] = []
): L.DivIcon {
  const shortLabel = escapeHtml(
    teamName.replace(/\s*\(.*\)/, '').trim().toUpperCase()
  );
  const visibleMembers = onlineMembers.slice(0, 4);
  const overflowCount = Math.max(0, onlineMembers.length - visibleMembers.length);

  const sardinesInsideHtml =
    visibleMembers.length > 0
      ? visibleMembers
          .map((m) => {
            const cfg = parseSardineAvatar(m.avatar, m);
            return `<span title="${escapeHtml(m.name)}" style="width:20px;height:22px;display:inline-flex;align-items:center;justify-content:center;margin:0 -1px;">${renderCompleteSardineSvgString(cfg, 22)}</span>`;
          })
          .join('') +
        (overflowCount > 0
          ? `<span style="margin-left:2px;padding:0 3px;border-radius:4px;background:${color};color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;line-height:14px;">+${overflowCount}</span>`
          : '')
      : `<span style="width:20px;height:22px;display:inline-flex;align-items:center;justify-content:center;opacity:0.38;">${renderCompleteSardineSvgString(DEFAULT_SARDINE_AVATAR, 20)}</span>`;

  const slotCount = Math.max(1, visibleMembers.length) + (overflowCount > 0 ? 1 : 0);
  const tinMinWidth = Math.max(66, 30 + slotCount * 19);
  const iconWidth = Math.max(108, tinMinWidth + 24);
  const iconHeight = 64;

  const pullRingSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 22" width="12" height="19" style="display:block;flex-shrink:0;margin-right:-2px;">
      <circle cx="5.5" cy="11" r="4.5" fill="none" stroke="#94A3B8" stroke-width="2.2" />
      <circle cx="5.5" cy="11" r="4.5" fill="none" stroke="#F8FAFC" stroke-width="0.9" />
      <rect x="9" y="8.5" width="5" height="5" rx="1.2" fill="#CBD5E1" stroke="#475569" stroke-width="1" />
    </svg>
  `;

  return L.divIcon({
    className: 'sardinen-div-icon sardinen-team-tin-icon',
    iconSize: [iconWidth, iconHeight],
    iconAnchor: [Math.round(iconWidth / 2), iconHeight - 5],
    popupAnchor: [0, -(iconHeight - 10)],
    html: `
      <div style="width:${iconWidth}px;height:${iconHeight}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;pointer-events:auto;">
        <!-- Team-Namensschild über der Büchse -->
        <div style="display:inline-flex;align-items:center;gap:4px;padding:1.5px 7px;margin-bottom:2px;border-radius:9999px;background:#14171A;border:1.5px solid ${color};color:#F8FAFC;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;letter-spacing:0.04em;white-space:nowrap;box-shadow:0 3px 8px rgba(15,23,42,0.32);">
          <span style="width:6px;height:6px;border-radius:9999px;background:${color};display:inline-block;"></span>
          <span>${shortLabel}</span>
          <span style="opacity:0.75;font-size:8.5px;">• ${onlineMembers.length}</span>
        </div>

        <!-- Geöffnete Sardinenbüchse (Aufreißlasche + Metallrand + aufgerollter Deckel + Online-Sardinen) -->
        <div style="display:inline-flex;align-items:center;">
          ${pullRingSvg}
          <div style="min-width:${tinMinWidth}px;padding:2.5px;border-radius:10px;background:linear-gradient(180deg,#F8FAFC 0%,#CBD5E1 52%,#94A3B8 100%);border:2px solid ${color};box-shadow:0 5px 14px rgba(15,23,42,0.38);display:flex;align-items:center;">
            <div style="flex:1;min-height:24px;padding:1px 5px;border-radius:6.5px;background:linear-gradient(180deg,#0F172A 0%,#1E293B 100%);border:1px solid #475569;box-shadow:inset 0 2px 4px rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;">
              ${sardinesInsideHtml}
            </div>
            <!-- Aufgerollter Blechdeckel am rechten Büchsenrand -->
            <div style="width:5px;height:24px;margin-left:2px;border-radius:3px;background:repeating-linear-gradient(180deg,#F8FAFC 0px,#F8FAFC 2px,#64748B 2px,#64748B 4px);border:1px solid #334155;"></div>
          </div>
        </div>

        <!-- Präziser GPS-Ankerpunkt -->
        <div style="width:9px;height:9px;border-radius:9999px;background:${color};border:2px solid #FFFFFF;margin-top:2px;box-shadow:0 2px 5px rgba(15,23,42,0.4);"></div>
      </div>
    `,
  });
}

export function renderTeamTinPopupHtml(params: {
  teamName: string;
  color: string;
  accuracyMeters: number;
  onlineMembers: OnlineTeamMemberBadge[];
  activeContributorCount?: number;
}): string {
  const {
    teamName,
    color,
    accuracyMeters,
    onlineMembers,
    activeContributorCount,
  } = params;
  const contributorInfo =
    activeContributorCount && activeContributorCount > 1
      ? ` [AVG:${activeContributorCount}]`
      : '';

  const membersListHtml =
    onlineMembers.length > 0
      ? `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px;">${onlineMembers
          .map((m) => {
            const cfg = parseSardineAvatar(m.avatar, m);
            return `<span style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:6px;background:#F1F5F9;border:1px solid #CBD5E1;font-size:11px;font-weight:700;color:#0F172A;">${renderCompleteSardineSvgString(cfg, 16)}<span>${escapeHtml(m.name)}</span></span>`;
          })
          .join('')}</div>`
      : `<div style="margin-top:4px;font-size:11px;color:#64748B;">Aktuell niemand online</div>`;

  return `<div style="min-width:140px;"><div style="display:flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:9999px;background:${color};display:inline-block;"></span><strong>${escapeHtml(teamName.toUpperCase())}</strong><span style="font-size:10px;color:#64748B;">${escapeHtml(contributorInfo)}</span></div><div style="font-size:11px;color:#475569;margin-top:2px;">GPS: ±${Math.round(accuracyMeters)} m • ${onlineMembers.length} in der Dose</div>${membersListHtml}</div>`;
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
  const bg = isPrimary ? '#FF4D00' : '#14171A';
  const border = isPrimary ? '2.5px solid #FFFFFF' : '1.5px solid #9AA4AE';
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `
      <div style="width:30px;height:30px;border-radius:9999px;background:${bg};border:${border};color:#F8FAFC;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(20,25,30,0.32);">
        ${safe}
      </div>
    `,
  });
}

/**
 * Hochsichtbarer Notfall-SOS-Marker (#DC2626 / #991B1B) mit konzentrischer Alarmwelle.
 */
export function createEmergencyBeaconIcon(senderName: string): L.DivIcon {
  const safeName = escapeHtml(senderName.toUpperCase());
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [132, 52],
    iconAnchor: [66, 38],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9999px;background:#991B1B;border:2px solid #FCA5A5;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:0.06em;white-space:nowrap;box-shadow:0 6px 18px rgba(220,38,38,0.55);">
          <span style="width:7px;height:7px;border-radius:9999px;background:#FFFFFF;display:inline-block;"></span>
          <span>SOS // ${safeName}</span>
        </div>
        <div style="position:relative;width:22px;height:22px;margin-top:1px;display:flex;align-items:center;justify-content:center;">
          <span class="cmf-sos-wave" style="position:absolute;inset:0;border-radius:9999px;background:rgba(220,38,38,0.58);pointer-events:none;"></span>
          <span style="position:relative;width:14px;height:14px;border-radius:9999px;background:#DC2626;border:2.5px solid #FFFFFF;box-shadow:0 0 14px rgba(220,38,38,0.85);"></span>
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
  const badgeBg = isFallbackSource ? '#B45309' : '#FF4D00';
  const dotBg = isFallbackSource ? '#F59E0B' : '#FF4D00';
  const label = isFallbackSource
    ? `PING #${pingNumber} (FALLBACK)`
    : `VERSTECKER-PING #${pingNumber}`;
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [148, 48],
    iconAnchor: [74, 36],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:9999px;background:${badgeBg};border:1.5px solid #FFFFFF;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:0.05em;white-space:nowrap;box-shadow:0 5px 14px rgba(20,25,30,0.38);">
          <span style="width:6px;height:6px;border-radius:9999px;background:#FFFFFF;display:inline-block;"></span>
          <span>${escapeHtml(label)}</span>
        </div>
        <div style="position:relative;width:20px;height:20px;margin-top:2px;display:flex;align-items:center;justify-content:center;">
          <span style="width:13px;height:13px;border-radius:9999px;background:${dotBg};border:2.5px solid #FFFFFF;box-shadow:0 0 12px rgba(255,77,0,0.75);"></span>
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
        <div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9999px;background:#DC2626;border:2px solid #FFFFFF;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:0.05em;white-space:nowrap;box-shadow:0 6px 18px rgba(220,38,38,0.55);">
          <span style="width:7px;height:7px;border-radius:9999px;background:#FFFFFF;display:inline-block;"></span>
          <span>LIVE // VERSTECKER</span>
        </div>
        <div style="position:relative;width:22px;height:22px;margin-top:1px;display:flex;align-items:center;justify-content:center;">
          <span class="cmf-sos-wave" style="position:absolute;inset:0;border-radius:9999px;background:rgba(220,38,38,0.58);pointer-events:none;"></span>
          <span style="position:relative;width:14px;height:14px;border-radius:9999px;background:#DC2626;border:2.5px solid #FFFFFF;box-shadow:0 0 14px rgba(220,38,38,0.85);"></span>
        </div>
      </div>
    `,
  });
}

/**
 * Live-Verstecker-Pin für Overview-Account & Sardinen-Rudel im Manhunt-Modus (#FF4D00).
 */
export function createLiveHiderOverviewIcon(label = 'VERSTECKER'): L.DivIcon {
  const safe = escapeHtml(label.toUpperCase());
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [120, 40],
    iconAnchor: [60, 28],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:9999px;background:#FF4D00;border:1.5px solid #FFFFFF;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:0.05em;white-space:nowrap;box-shadow:0 4px 12px rgba(20,25,30,0.32);">
          <span style="width:6px;height:6px;border-radius:9999px;background:#FFFFFF;display:inline-block;"></span>
          <span>${safe}</span>
        </div>
        <div style="width:11px;height:11px;border-radius:9999px;background:#FF4D00;border:2px solid #FFFFFF;margin-top:2px;box-shadow:0 2px 6px rgba(255,77,0,0.5);"></div>
      </div>
    `,
  });
}
