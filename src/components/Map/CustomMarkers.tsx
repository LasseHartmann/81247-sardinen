import L from 'leaflet';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Eigene Position — Aktiver CMF-Signal-Orange Fokus-Pin (#FF4D00) mit scharfem weißem Rand.
 */
export function createOwnPositionIcon(isHider: boolean): L.DivIcon {
  const coreColor = '#FF4D00';
  const ringBorder = isHider ? '#00A896' : '#FF4D00';
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `
      <div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;inset:1px;border-radius:9999px;background:rgba(255,77,0,0.20);border:1.5px dashed ${ringBorder};"></span>
        <span style="width:15px;height:15px;border-radius:9999px;background:${coreColor};border:2.5px solid #FFFFFF;box-shadow:0 3px 10px rgba(20,25,30,0.35);"></span>
      </div>
    `,
  });
}

/**
 * Geheimer Anchor-Point-Marker („Sardinen-Versteck") — Primärer Hardware-Pin in #FF4D00 mit weißem Text/Rand.
 */
export function createAnchorPointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `
      <div style="width:40px;height:40px;border-radius:9999px;background:#FF4D00;border:2.5px solid #FFFFFF;box-shadow:0 6px 18px rgba(255,77,0,0.38);display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;letter-spacing:0.04em;">
        HQ
      </div>
    `,
  });
}

/**
 * Sekundärer Team-Beacon-Marker (#14171A mit hellem Text und dezentem grauem Hardware-Rand).
 */
export function createTeamBeaconIcon(teamName: string, color: string): L.DivIcon {
  const shortLabel = escapeHtml(teamName.replace(/\s*\(.*\)/, '').toUpperCase());
  return L.divIcon({
    className: 'sardinen-div-icon',
    iconSize: [96, 36],
    iconAnchor: [48, 18],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:9999px;background:#14171A;border:1px solid #9AA4AE;color:#F8FAFC;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.05em;white-space:nowrap;box-shadow:0 4px 12px rgba(20,25,30,0.28);">
          <span style="width:6px;height:6px;border-radius:9999px;background:${color};display:inline-block;"></span>
          <span>${shortLabel}</span>
        </div>
        <div style="width:10px;height:10px;border-radius:9999px;background:#14171A;border:2px solid #FFFFFF;margin-top:2px;box-shadow:0 2px 5px rgba(20,25,30,0.3);"></div>
      </div>
    `,
  });
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
