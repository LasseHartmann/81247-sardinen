import L from 'leaflet';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Eigene Position (blau/cyan pulsierender Punkt, 100% HTML/CSS ohne Leaflet-PNGs).
 */
export function createOwnPositionIcon(isHider: boolean): L.DivIcon {
  const ringColor = isHider ? '#06b6d4' : '#38bdf8';
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `
      <div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;inset:0;border-radius:9999px;background:${ringColor};opacity:0.28;transform:scale(1.15);"></span>
        <span style="width:14px;height:14px;border-radius:9999px;background:${ringColor};border:2.5px solid #f8fafc;box-shadow:0 0 10px ${ringColor};"></span>
      </div>
    `,
  });
}

/**
 * Geheimer Anchor-Point-Marker („Sardinen-Versteck") für Verstecker, Host und gefangene Teams.
 */
export function createAnchorPointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    html: `
      <div style="width:38px;height:38px;border-radius:9999px;background:#020617;border:2.5px solid #06b6d4;box-shadow:0 0 14px rgba(6,182,212,0.75);display:flex;align-items:center;justify-content:center;color:#06b6d4;font-weight:800;font-size:13px;">
        🐟
      </div>
    `,
  });
}

/**
 * Team-Beacon-Marker für eigene Sucher-Position bzw. Hider/Host-Übersicht.
 */
export function createTeamBeaconIcon(teamName: string, color: string): L.DivIcon {
  const shortLabel = escapeHtml(teamName.replace(/\s*\(.*\)/, ''));
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [86, 34],
    iconAnchor: [43, 17],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="padding:2px 7px;border-radius:9999px;background:#020617e6;border:2px solid ${color};color:#f8fafc;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.65);">
          ${shortLabel}
        </div>
        <div style="width:10px;height:10px;border-radius:9999px;background:${color};border:2px solid #ffffff;margin-top:2px;"></div>
      </div>
    `,
  });
}

/**
 * Auswahl-Pin für Kartenteiler- oder Thermometer-Punkte.
 */
export function createSelectionPinIcon(label: string, color = '#f59e0b'): L.DivIcon {
  const safe = escapeHtml(label);
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `
      <div style="width:30px;height:30px;border-radius:9999px;background:${color};border:2px solid #020617;color:#020617;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.65);">
        ${safe}
      </div>
    `,
  });
}
