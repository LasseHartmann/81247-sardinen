import type { Feature, MultiPolygon, Polygon } from 'geojson';
import * as turf from '@turf/turf';
import defaultPlayAreaJson from './playArea.geojson';
import munichPlzBoundariesJson from './munichPlzBoundaries.json';
import type {
  LatLng,
  PlayAreaState,
  PublicGameState,
  QuestionType,
  RadarSchedule,
  RadarStageId,
  SafetyPoint,
  TeamPublic,
} from '../types/game';

export const GAME_ID = '81247' as const;
export const DEFAULT_POSTAL_CODE = '81247' as const;

export interface MunichPlzEntry {
  postalCode: string;
  district: string;
  name: string;
  center: LatLng;
  ring: [number, number][];
}

export const MUNICH_PLZ_LIST: readonly MunichPlzEntry[] =
  munichPlzBoundariesJson as unknown as MunichPlzEntry[];

export const ALL_MUNICH_POSTAL_CODES: readonly string[] = MUNICH_PLZ_LIST.map(
  (entry) => entry.postalCode
);

const MUNICH_PLZ_BY_CODE = new Map<string, MunichPlzEntry>(
  MUNICH_PLZ_LIST.map((entry) => [entry.postalCode, entry])
);

export function isAllMunichPostalCodes(
  codes?: readonly string[] | null
): boolean {
  if (!codes || codes.length < MUNICH_PLZ_LIST.length) return false;
  const set = new Set(codes);
  return MUNICH_PLZ_LIST.every((entry) => set.has(entry.postalCode));
}

export function formatPostalCodesLabel(
  codes?: readonly string[] | null
): string {
  if (!codes || codes.length === 0) return DEFAULT_POSTAL_CODE;
  if (isAllMunichPostalCodes(codes)) return 'Ganz München';
  return codes.join(', ');
}

export const MAP_DEFAULT_CENTER: [number, number] = [48.1682, 11.465];
export const MAP_DEFAULT_ZOOM = 14;

export const OFFICIAL_81247_AREA_NAME =
  '81247 M-Obermenzing (Offizielle PLZ-Grenze)';
export const LEGACY_PLACEHOLDER_AREA_NAME =
  '81247 München (Obermenzing / Blutenburg / Pipping)';

export const DEFAULT_PLAY_AREA_FEATURE =
  defaultPlayAreaJson as unknown as Feature<Polygon>;

export function isValidMunichPostalCode(
  postalCode?: string | null
): postalCode is string {
  return Boolean(postalCode && MUNICH_PLZ_BY_CODE.has(postalCode.trim()));
}

export interface ParsedMunichPostalCodes {
  validCodes: string[];
  notFoundCodes: string[];
  entries: MunichPlzEntry[];
}

/**
 * Zerlegt eine Texteingabe (z. B. "81247, 81245 89999") oder ein Array von PLZ-Strings
 * in gefundene Münchner PLZ (`validCodes`) und nicht gefundene PLZ (`notFoundCodes`).
 */
export function parseAndValidateMunichPostalCodes(
  rawInput?: string | readonly string[] | null
): ParsedMunichPostalCodes {
  if (!rawInput) {
    return { validCodes: [], notFoundCodes: [], entries: [] };
  }
  if (!Array.isArray(rawInput)) {
    const normalizedWhole = String(rawInput)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (
      normalizedWhole === 'ganz münchen' ||
      normalizedWhole === 'ganz muenchen' ||
      normalizedWhole === 'münchen' ||
      normalizedWhole === 'muenchen' ||
      normalizedWhole === 'alle' ||
      normalizedWhole === 'alle plz'
    ) {
      return {
        validCodes: [...ALL_MUNICH_POSTAL_CODES],
        notFoundCodes: [],
        entries: [...MUNICH_PLZ_LIST],
      };
    }
  }
  const tokens = Array.isArray(rawInput)
    ? rawInput.flatMap((item) => {
        const s = String(item ?? '').trim();
        const lower = s.toLowerCase().replace(/\s+/g, ' ');
        if (
          lower === 'ganz münchen' ||
          lower === 'ganz muenchen' ||
          lower === 'münchen' ||
          lower === 'muenchen' ||
          lower === 'alle'
        ) {
          return [...ALL_MUNICH_POSTAL_CODES];
        }
        return s.split(/[\s,;+/|]+/).map((t) => t.trim());
      })
    : String(rawInput)
        .split(/[\s,;+/|]+/)
        .map((t) => t.trim());

  const validCodes: string[] = [];
  const notFoundCodes: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();

  for (const token of tokens) {
    if (!token) continue;
    if (MUNICH_PLZ_BY_CODE.has(token)) {
      if (!seenValid.has(token)) {
        seenValid.add(token);
        validCodes.push(token);
      }
    } else if (!seenInvalid.has(token)) {
      seenInvalid.add(token);
      notFoundCodes.push(token);
    }
  }

  return {
    validCodes,
    notFoundCodes,
    entries: validCodes
      .map((code) => MUNICH_PLZ_BY_CODE.get(code))
      .filter((e): e is MunichPlzEntry => Boolean(e)),
  };
}

export function getActivePostalCodes(
  playArea?: Pick<PlayAreaState, 'postalCode' | 'postalCodes'> | null
): string[] {
  if (Array.isArray(playArea?.postalCodes) && playArea.postalCodes.length > 0) {
    const parsed = parseAndValidateMunichPostalCodes(playArea.postalCodes);
    if (parsed.validCodes.length > 0) return parsed.validCodes;
  }
  if (playArea?.postalCode) {
    const parsed = parseAndValidateMunichPostalCodes(playArea.postalCode);
    if (parsed.validCodes.length > 0) return parsed.validCodes;
  }
  return [DEFAULT_POSTAL_CODE];
}

export function getMunichPlzEntry(postalCode?: string | null): MunichPlzEntry {
  const parsed = parseAndValidateMunichPostalCodes(postalCode);
  const code = parsed.validCodes[0] ?? DEFAULT_POSTAL_CODE;
  return (
    MUNICH_PLZ_BY_CODE.get(code) ??
    MUNICH_PLZ_BY_CODE.get(DEFAULT_POSTAL_CODE) ?? {
      postalCode: DEFAULT_POSTAL_CODE,
      district: 'Obermenzing / Blutenburg / Pipping',
      name: OFFICIAL_81247_AREA_NAME,
      center: { lat: MAP_DEFAULT_CENTER[0], lng: MAP_DEFAULT_CENTER[1] },
      ring: DEFAULT_PLAY_AREA_FEATURE.geometry.coordinates[0] as [
        number,
        number,
      ][],
    }
  );
}

export function buildMunichPlzPolygon(
  postalCode?: string | null
): Feature<Polygon> {
  const entry = getMunichPlzEntry(postalCode);
  if (entry.postalCode === DEFAULT_POSTAL_CODE) {
    const clone = structuredClone(DEFAULT_PLAY_AREA_FEATURE);
    clone.properties = {
      ...(clone.properties ?? {}),
      postalCode: DEFAULT_POSTAL_CODE,
      postalCodes: [DEFAULT_POSTAL_CODE],
    };
    return clone;
  }
  return turf.polygon([entry.ring.map(([lng, lat]) => [lng, lat])], {
    name: entry.name,
    postalCode: entry.postalCode,
    postalCodes: [entry.postalCode],
  });
}

const multiPlzPolygonCache = new Map<
  string,
  Feature<Polygon | MultiPolygon>
>();

export function buildMunichMultiPlzPolygon(
  postalCodesInput?: string | readonly string[] | null
): Feature<Polygon | MultiPolygon> {
  const parsed = parseAndValidateMunichPostalCodes(postalCodesInput);
  const codes =
    parsed.validCodes.length > 0 ? parsed.validCodes : [DEFAULT_POSTAL_CODE];

  if (codes.length === 1) {
    return buildMunichPlzPolygon(codes[0]);
  }

  const cacheKey = [...codes].sort().join(',');
  const cached = multiPlzPolygonCache.get(cacheKey);
  if (cached) {
    const clone = structuredClone(cached);
    const label = formatPostalCodesLabel(codes);
    clone.properties = {
      name: isAllMunichPostalCodes(codes)
        ? 'Ganz München (Alle 75 PLZ-Gebiete)'
        : `PLZ ${label}`,
      postalCode: label,
      postalCodes: codes,
    };
    return clone;
  }

  const singlePolys = codes.map((code) => {
    const entry = getMunichPlzEntry(code);
    return turf.polygon(
      [
        entry.ring.map(([lng, lat]) => [
          Math.round(lng * 1e5) / 1e5,
          Math.round(lat * 1e5) / 1e5,
        ]),
      ],
      {
        name: entry.name,
        postalCode: entry.postalCode,
        postalCodes: [entry.postalCode],
      }
    );
  });
  const combinedLabel = formatPostalCodesLabel(codes);
  let merged: Feature<Polygon | MultiPolygon> | null = null;
  try {
    merged = turf.union(turf.featureCollection(singlePolys));
  } catch {
    let acc: Feature<Polygon | MultiPolygon> = singlePolys[0];
    for (let i = 1; i < singlePolys.length; i++) {
      try {
        const next = turf.union(turf.featureCollection([acc, singlePolys[i]]));
        if (next) acc = next;
      } catch {
        // Fallback weiter unten
      }
    }
    merged = acc;
  }

  if (!merged) {
    merged = turf.multiPolygon(
      singlePolys.map((p) => p.geometry.coordinates)
    );
  }

  if (
    isAllMunichPostalCodes(codes) &&
    merged.geometry.type === 'Polygon' &&
    merged.geometry.coordinates.length > 1
  ) {
    merged.geometry.coordinates = [merged.geometry.coordinates[0]];
  }

  merged.properties = {
    name: isAllMunichPostalCodes(codes)
      ? 'Ganz München (Alle 75 PLZ-Gebiete)'
      : `PLZ ${combinedLabel}`,
    postalCode: combinedLabel,
    postalCodes: codes,
  };
  multiPlzPolygonCache.set(cacheKey, structuredClone(merged));
  return merged;
}

export const PLAY_AREA_CIRCLE_MIN_RADIUS_METERS = 100;
export const PLAY_AREA_CIRCLE_MAX_RADIUS_METERS = 2500;
export const PLAY_AREA_CIRCLE_STEP_METERS = 100;
export const DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS = 800;
export const DEFAULT_PLAY_AREA_CIRCLE_CENTER: LatLng = {
  lat: MAP_DEFAULT_CENTER[0],
  lng: MAP_DEFAULT_CENTER[1],
};

export function clampPlayAreaCircleRadius(radiusMeters: number): number {
  const safe = Number.isFinite(radiusMeters)
    ? radiusMeters
    : DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS;
  const stepped =
    Math.round(safe / PLAY_AREA_CIRCLE_STEP_METERS) *
    PLAY_AREA_CIRCLE_STEP_METERS;
  return Math.min(
    PLAY_AREA_CIRCLE_MAX_RADIUS_METERS,
    Math.max(PLAY_AREA_CIRCLE_MIN_RADIUS_METERS, stepped)
  );
}

export function buildCirclePlayAreaPolygon(
  center: LatLng,
  radiusMeters: number,
  postalCodesInput: string | readonly string[] = DEFAULT_POSTAL_CODE
): Feature<Polygon> {
  const parsed = parseAndValidateMunichPostalCodes(postalCodesInput);
  const codes =
    parsed.validCodes.length > 0 ? parsed.validCodes : [DEFAULT_POSTAL_CODE];
  const combinedLabel = formatPostalCodesLabel(codes);
  const clampedRadius = clampPlayAreaCircleRadius(radiusMeters);
  return turf.circle([center.lng, center.lat], clampedRadius, {
    steps: 72,
    units: 'meters',
    properties: {
      name: `${combinedLabel} Kreis-Spielfeld (${clampedRadius} m)`,
      postalCode: combinedLabel,
      postalCodes: codes,
    },
  });
}

export function buildMunichPlzPlayAreaState(
  postalCodesInput: string | readonly string[],
  confirmedByUid = 'osm_official_munich',
  nowMs = Date.now()
): PlayAreaState {
  const parsed = parseAndValidateMunichPostalCodes(postalCodesInput);
  const codes =
    parsed.validCodes.length > 0 ? parsed.validCodes : [DEFAULT_POSTAL_CODE];
  const entries = codes.map((c) => getMunichPlzEntry(c));
  const isSingle81247 =
    codes.length === 1 && codes[0] === DEFAULT_POSTAL_CODE;
  const isFullMunich = isAllMunichPostalCodes(codes);
  const combinedLabel = formatPostalCodesLabel(codes);
  const areaName = isSingle81247
    ? OFFICIAL_81247_AREA_NAME
    : isFullMunich
      ? 'Ganz München (Alle 75 PLZ-Gebiete)'
      : codes.length === 1
        ? entries[0].name
        : `PLZ ${combinedLabel} (${entries
            .map((e) => e.district.split(' / ')[0])
            .join(' + ')})`;

  return {
    polygon: buildMunichMultiPlzPolygon(codes),
    confirmed: true,
    confirmedAt: nowMs,
    confirmedByUid:
      isSingle81247 && confirmedByUid === 'osm_official_munich'
        ? 'osm_official_81247'
        : confirmedByUid,
    name: areaName,
    postalCode: combinedLabel,
    postalCodes: codes,
    shapeType: 'OFFICIAL_81247',
    circle: null,
  };
}

export function buildFullMunichPlayAreaState(
  confirmedByUid = 'osm_official_munich',
  nowMs = Date.now()
): PlayAreaState {
  return buildMunichPlzPlayAreaState(
    ALL_MUNICH_POSTAL_CODES,
    confirmedByUid,
    nowMs
  );
}

export function buildOfficial81247PlayAreaState(
  confirmedByUid = 'osm_official_81247',
  nowMs = Date.now(),
  postalCodesInput: string | readonly string[] = DEFAULT_POSTAL_CODE
): PlayAreaState {
  return buildMunichPlzPlayAreaState(postalCodesInput, confirmedByUid, nowMs);
}

export function buildCustomCirclePlayAreaState(params: {
  center: LatLng;
  radiusMeters: number;
  confirmedByUid: string;
  nowMs?: number;
  postalCode?: string | readonly string[];
  postalCodes?: readonly string[];
}): PlayAreaState {
  const parsed = parseAndValidateMunichPostalCodes(
    params.postalCodes ?? params.postalCode
  );
  const codes =
    parsed.validCodes.length > 0 ? parsed.validCodes : [DEFAULT_POSTAL_CODE];
  const combinedLabel = formatPostalCodesLabel(codes);
  const clampedRadius = clampPlayAreaCircleRadius(params.radiusMeters);
  const roundedCenter: LatLng = {
    lat: Math.round(params.center.lat * 100_000) / 100_000,
    lng: Math.round(params.center.lng * 100_000) / 100_000,
  };
  return {
    polygon: buildCirclePlayAreaPolygon(roundedCenter, clampedRadius, codes),
    confirmed: true,
    confirmedAt: params.nowMs ?? Date.now(),
    confirmedByUid: params.confirmedByUid,
    name: `Kreis-Spielfeld in ${combinedLabel} (${clampedRadius} m)`,
    postalCode: combinedLabel,
    postalCodes: codes,
    shapeType: 'CUSTOM_CIRCLE',
    circle: {
      center: roundedCenter,
      radiusMeters: clampedRadius,
    },
  };
}

export function isLegacyPlaceholderPlayArea(
  playArea: PublicGameState['playArea'] | null | undefined
): boolean {
  if (!playArea || !playArea.polygon) return true;
  if (playArea.shapeType === 'CUSTOM_CIRCLE') return false;
  if (
    Array.isArray(playArea.postalCodes) &&
    parseAndValidateMunichPostalCodes(playArea.postalCodes).validCodes.length > 0
  ) {
    return false;
  }
  if (
    playArea.postalCode &&
    parseAndValidateMunichPostalCodes(playArea.postalCode).validCodes.length > 0
  ) {
    return false;
  }
  if (playArea.name === LEGACY_PLACEHOLDER_AREA_NAME) return true;
  if (playArea.polygon.geometry?.type === 'MultiPolygon') return false;
  const ringLen = playArea.polygon.geometry?.coordinates?.[0]?.length ?? 0;
  // Altes Platzhalter-Polygon aus der Erstinitialisierung hatte nur 9 Eckpunkte (10 Ring-Koordinaten)
  if (
    ringLen <= 12 &&
    playArea.confirmedByUid !== 'osm_official_81247' &&
    playArea.confirmedByUid !== 'osm_official_munich' &&
    playArea.name !== OFFICIAL_81247_AREA_NAME
  ) {
    return true;
  }
  return false;
}

/**
 * Bereinigt gespeicherte Mehr-PLZ- oder „Ganz München“-Polygone, falls diese aus älteren Sitzungen
 * noch interne Sliver-Ringe rund um 81247 enthalten.
 */
export function sanitizePlayAreaState(playArea: PlayAreaState): PlayAreaState {
  if (!playArea || playArea.shapeType === 'CUSTOM_CIRCLE') {
    return playArea;
  }
  const activeCodes = getActivePostalCodes(playArea);
  if (
    activeCodes.length > 1 &&
    playArea.polygon?.geometry?.type === 'Polygon' &&
    playArea.polygon.geometry.coordinates.length > 1
  ) {
    return {
      ...playArea,
      polygon: buildMunichMultiPlzPolygon(activeCodes),
    };
  }
  return playArea;
}

export const DEFAULT_SAFETY_POINT: SafetyPoint = {
  name: 'Schloss Blutenburg — Vorplatz (Seldweg)',
  description:
    'Zentraler Sammelpunkt vor dem Haupttor von Schloss Blutenburg (gut erreichbar per Fußweg & Bus 143/160).',
  lat: 48.1632,
  lng: 11.4572,
};

export const DEFAULT_CLASSIC_HIDING_MINUTES = 15;
export const DEFAULT_CLASSIC_SEARCH_MINUTES = 45;
export const CLASSIC_SEARCH_DURATION_STEPS_MINUTES = [30, 45, 60, 75, 90] as const;

export const DEFAULT_RADAR_SCHEDULE: RadarSchedule = {
  hidingDurationMs: DEFAULT_CLASSIC_HIDING_MINUTES * 60_000, // 15:00 Standard-Versteckzeit
  stage1Ms: 30 * 60_000, // +15:00 Suche -> 800m
  stage2Ms: Math.round(37.5 * 60_000), // +22:30 Suche -> 400m
  stage3Ms: 45 * 60_000, // +30:00 Suche -> 200m
  stage4Ms: Math.round(52.5 * 60_000), // +37:30 Suche -> 100m
  stage5Ms: 60 * 60_000, // +45:00 Suche -> 25m
};

export const DEFAULT_MANHUNT_HIDING_MINUTES = 5;
export const DEFAULT_MANHUNT_SHRINK_MINUTES = 40;

export const MANHUNT_PING_INTERVAL_INITIAL_MS = 10 * 60_000; // Erste 3/4 der Spielzeit: alle 10 Min.
export const MANHUNT_PING_INTERVAL_LAST_QUARTER_MS = 5 * 60_000; // Letztes Viertel der Spielzeit: alle 5 Min.

export const MANHUNT_RADAR_RADII: Record<RadarStageId, number> = {
  1: 1200,
  2: 800,
  3: 500,
  4: 300,
  5: 150,
};

export interface ManhuntPingStatus {
  /** Absolute Netto-Spielzeit (ab Rundenstart) des zuletzt fälligen Pings, oder null vor dem ersten Ping */
  duePingElapsedMs: number | null;
  /** 1-basierte Nummer des aktuell fälligen Pings (0 vor dem ersten Ping) */
  duePingNumber: number;
  /** Zugehörige Zonen-Stufe (1..5) des aktuell fälligen Pings, oder null vor dem ersten Ping */
  dueStageId: RadarStageId | null;
  /** Zugehöriger Zonen-Radius (1200..150 m) des aktuell fälligen Pings, oder null vor dem ersten Ping */
  dueRadiusMeters: number | null;
  /** Absolute Netto-Spielzeit (ab Rundenstart) des nächsten bevorstehenden Pings */
  nextPingElapsedMs: number;
  /** Aktuelles Ping-Intervall in Minuten (10 in den ersten 3/4, 5 im letzten Viertel) */
  currentIntervalMinutes: 10 | 5;
  /** Ob sich die Jagd aktuell im letzten Viertel (oder in der Verlängerung) der angegebenen Spielzeit befindet */
  isInLastQuarter: boolean;
  /** Geplante Ping-Zeitpunkte (Netto-Spielzeit ab Rundenstart) innerhalb der regulären Jagddauer */
  scheduledPingElapsedMs: number[];
}

/**
 * Berechnet alle Manhunt-Ping-Zeitpunkte (in ms Netto-Spielzeit ab Rundenstart):
 * - Während des Vorsprungs (`0 .. headStartMs`) wird noch nicht gepingt.
 * - In den ersten 3/4 der angegebenen Spielzeit (`huntDurationMs`) wird alle 10 Min. gepingt.
 * - Im letzten Viertel (`>= 0.75 * huntDurationMs`, sowie in einer evtl. Verlängerung) wird alle 5 Min. gepingt.
 */
export function getManhuntPingScheduleMs(
  headStartMs: number,
  huntDurationMs: number,
  upToNetElapsedMs?: number
): number[] {
  const safeHeadStartMs = Math.max(0, Math.round(headStartMs));
  const safeHuntDurationMs = Math.max(10 * 60_000, Math.round(huntDurationMs));
  const lastQuarterStartRelMs = Math.round(safeHuntDurationMs * 0.75);

  const schedule: number[] = [];
  let relMs = 0;

  while (
    relMs < safeHuntDurationMs ||
    (upToNetElapsedMs !== undefined && safeHeadStartMs + relMs <= upToNetElapsedMs)
  ) {
    const nextFiveRelMs = relMs + MANHUNT_PING_INTERVAL_LAST_QUARTER_MS;
    const stepMs =
      nextFiveRelMs >= lastQuarterStartRelMs
        ? MANHUNT_PING_INTERVAL_LAST_QUARTER_MS
        : MANHUNT_PING_INTERVAL_INITIAL_MS;
    relMs += stepMs;
    schedule.push(safeHeadStartMs + relMs);
  }

  return schedule;
}

/**
 * Liefert für einen beliebigen Netto-Spielzeitpunkt `netElapsedMs` den aktuellen Manhunt-Ping-Status
 * (fälliger Ping, Ping-Nummer, Zonen-Stufe/Radius, nächster Ping-Zeitpunkt und Intervall).
 */
export function getManhuntPingStatusAtElapsedMs(
  netElapsedMs: number,
  headStartMs: number,
  huntDurationMs: number
): ManhuntPingStatus {
  const safeHeadStartMs = Math.max(0, Math.round(headStartMs));
  const safeHuntDurationMs = Math.max(10 * 60_000, Math.round(huntDurationMs));
  const lastQuarterStartRelMs = Math.round(safeHuntDurationMs * 0.75);

  const scheduledPingElapsedMs = getManhuntPingScheduleMs(
    safeHeadStartMs,
    safeHuntDurationMs
  );
  const extendedSchedule = getManhuntPingScheduleMs(
    safeHeadStartMs,
    safeHuntDurationMs,
    Math.max(0, netElapsedMs)
  );

  let dueIndex = -1;
  if (netElapsedMs >= safeHeadStartMs) {
    for (let i = 0; i < extendedSchedule.length; i++) {
      if (extendedSchedule[i] <= netElapsedMs) {
        dueIndex = i;
      } else {
        break;
      }
    }
  }

  const huntElapsedMs = Math.max(0, netElapsedMs - safeHeadStartMs);
  const isInLastQuarter =
    netElapsedMs >= safeHeadStartMs && huntElapsedMs >= lastQuarterStartRelMs;

  if (dueIndex < 0) {
    const nextPingElapsedMs =
      extendedSchedule[0] ?? safeHeadStartMs + MANHUNT_PING_INTERVAL_INITIAL_MS;
    const currentIntervalMinutes: 10 | 5 =
      nextPingElapsedMs - safeHeadStartMs <= MANHUNT_PING_INTERVAL_LAST_QUARTER_MS
        ? 5
        : 10;
    return {
      duePingElapsedMs: null,
      duePingNumber: 0,
      dueStageId: null,
      dueRadiusMeters: null,
      nextPingElapsedMs,
      currentIntervalMinutes,
      isInLastQuarter,
      scheduledPingElapsedMs,
    };
  }

  const duePingElapsedMs = extendedSchedule[dueIndex];
  const duePingNumber = dueIndex + 1;
  const nextPingElapsedMs =
    extendedSchedule[dueIndex + 1] ??
    duePingElapsedMs + MANHUNT_PING_INTERVAL_LAST_QUARTER_MS;

  const totalBasePings = scheduledPingElapsedMs.length;
  let dueStageId: RadarStageId;
  if (
    totalBasePings <= 1 ||
    duePingNumber >= totalBasePings ||
    duePingElapsedMs >= safeHeadStartMs + safeHuntDurationMs
  ) {
    dueStageId = 5;
  } else if (duePingNumber === 1) {
    dueStageId = 1;
  } else {
    const mapped = Math.min(
      5,
      Math.max(1, Math.round(1 + ((duePingNumber - 1) / (totalBasePings - 1)) * 4))
    );
    dueStageId = mapped as RadarStageId;
  }

  const dueRadiusMeters = MANHUNT_RADAR_RADII[dueStageId];
  const currentIntervalMinutes: 10 | 5 =
    nextPingElapsedMs - duePingElapsedMs <= MANHUNT_PING_INTERVAL_LAST_QUARTER_MS
      ? 5
      : 10;

  return {
    duePingElapsedMs,
    duePingNumber,
    dueStageId,
    dueRadiusMeters,
    nextPingElapsedMs,
    currentIntervalMinutes,
    isInLastQuarter,
    scheduledPingElapsedMs,
  };
}

/**
 * Berechnet den Radar-Schrumpfplan für das klassische Sardinen-Spiel:
 * - Erstes Drittel (`2/6`) von `searchDurationMinutes` (30 / 45 / 60 / 75 / 90 Min., Standard 45 Min.) ist offene Suche.
 * - Danach schrumpft das Radar in 4 gleichmäßigen Schritten (`2/6`, `3/6`, `4/6`, `5/6`, `6/6` der Suchdauer)
 *   von 800 m -> 400 m -> 200 m -> 100 m -> 25 m.
 */
export function buildRadarScheduleForHidingMs(
  hidingDurationMs: number,
  searchDurationMs = DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000
): RadarSchedule {
  const safeHidingMs = Math.max(0, Math.round(hidingDurationMs));
  const safeSearchMs = Math.min(
    90 * 60_000,
    Math.max(30 * 60_000, Math.round(searchDurationMs))
  );
  return {
    hidingDurationMs: safeHidingMs,
    stage1Ms: safeHidingMs + Math.round((safeSearchMs * 2) / 6),
    stage2Ms: safeHidingMs + Math.round((safeSearchMs * 3) / 6),
    stage3Ms: safeHidingMs + Math.round((safeSearchMs * 4) / 6),
    stage4Ms: safeHidingMs + Math.round((safeSearchMs * 5) / 6),
    stage5Ms: safeHidingMs + safeSearchMs,
  };
}

export function buildRadarScheduleForHidingMinutes(
  hidingMinutes: number,
  searchDurationMinutes = DEFAULT_CLASSIC_SEARCH_MINUTES
): RadarSchedule {
  const clampedMin = Math.max(0, Math.round(hidingMinutes));
  const clampedSearchMin = Math.min(90, Math.max(30, Math.round(searchDurationMinutes)));
  return buildRadarScheduleForHidingMs(
    clampedMin * 60_000,
    clampedSearchMin * 60_000
  );
}

export function buildManhuntRadarScheduleForHidingMs(
  hidingDurationMs: number,
  shrinkDurationMs = DEFAULT_MANHUNT_SHRINK_MINUTES * 60_000
): RadarSchedule {
  const safeHeadStartMs = Math.max(0, Math.round(hidingDurationMs));
  const safeShrinkMs = Math.min(
    80 * 60_000,
    Math.max(10 * 60_000, Math.round(shrinkDurationMs))
  );
  const pings = getManhuntPingScheduleMs(safeHeadStartMs, safeShrinkMs);

  const pickStageMs = (stageIdxZeroBased: number): number => {
    if (pings.length === 0) {
      return (
        safeHeadStartMs + Math.round(((stageIdxZeroBased + 1) * safeShrinkMs) / 5)
      );
    }
    if (stageIdxZeroBased === 0) return pings[0];
    if (stageIdxZeroBased === 4) return pings[pings.length - 1];
    const mappedIdx = Math.min(
      pings.length - 1,
      Math.max(0, Math.round((stageIdxZeroBased / 4) * (pings.length - 1)))
    );
    return pings[mappedIdx];
  };

  return {
    hidingDurationMs: safeHeadStartMs,
    stage1Ms: pickStageMs(0),
    stage2Ms: pickStageMs(1),
    stage3Ms: pickStageMs(2),
    stage4Ms: pickStageMs(3),
    stage5Ms: pickStageMs(4),
  };
}

/**
 * Erzeugt den Manhunt-Schrumpf- & Ping-Plan:
 * Nach `headStartMinutes` (0..30 Min.) startet die Jagd auf dem vollen 81247-Gebiet.
 * In den ersten 3/4 von `totalShrinkMinutes` (10..80 Min.) werden die Verstecker alle 10 Min. gepingt,
 * im letzten Viertel alle 5 Min., wobei die Zone um die Verstecker bis auf 150 m schrumpft.
 */
export function buildManhuntRadarSchedule(
  headStartMinutes: number,
  totalShrinkMinutes = DEFAULT_MANHUNT_SHRINK_MINUTES
): RadarSchedule {
  const clampedHeadStart = Math.min(30, Math.max(0, Math.round(headStartMinutes)));
  const clampedShrinkMin = Math.min(80, Math.max(10, Math.round(totalShrinkMinutes)));
  return buildManhuntRadarScheduleForHidingMs(
    clampedHeadStart * 60_000,
    clampedShrinkMin * 60_000
  );
}

export const QUESTION_CATEGORY_MAP: Record<QuestionType, 1 | 2 | 3 | 4> = {
  SPLIT_NS: 1,
  SPLIT_EW: 1,
  THERMOMETER: 1,
  CONE_45: 1,
  OSM_TRANSIT: 2,
  OSM_RECYCLING: 2,
  OSM_GREEN: 2,
  RADIUS_RADAR: 3,
  DONUT_RING: 3,
  MEDIA_SKY: 4,
  MEDIA_GROUND: 4,
  MEDIA_SELFIE: 4,
};

export const QUESTION_PENALTY_MS: Record<1 | 2 | 3 | 4, number> = {
  1: 15 * 60_000,
  2: 3 * 60_000,
  3: 4 * 60_000,
  4: 5 * 60_000,
};

export const THERMOMETER_MIN_DISTANCE_METERS = 250;

function scalePenaltyMinutes(
  baseMinutes: number,
  searchDurationMs?: number
): number {
  const effectiveSearchMs =
    typeof searchDurationMs === 'number' &&
    Number.isFinite(searchDurationMs) &&
    searchDurationMs > 0
      ? searchDurationMs
      : DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000;
  const ratio = effectiveSearchMs / (DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000);
  const scaledMinutes = Math.max(1, Math.round(baseMinutes * ratio));
  return scaledMinutes * 60_000;
}

export function getQuestionPenaltyMs(
  questionType: QuestionType,
  searchDurationMs?: number
): number {
  let baseMinutes: number;
  switch (questionType) {
    case 'SPLIT_NS':
    case 'SPLIT_EW':
    case 'RADIUS_RADAR':
    case 'CONE_45':
      baseMinutes = 15; // Himmelsrichtung / Radar: +15 Min. (bei 45 Min. Suchdauer)
      break;
    case 'THERMOMETER':
      baseMinutes = 10; // Thermometer (250 m): +10 Min. (bei 45 Min. Suchdauer)
      break;
    case 'MEDIA_SKY':
    case 'MEDIA_GROUND':
    case 'MEDIA_SELFIE':
      baseMinutes = 5; // Foto: +5 Min. (bei 45 Min. Suchdauer)
      break;
    case 'DONUT_RING':
      baseMinutes = 4; // Donut-Ring: +4 Min. (bei 45 Min. Suchdauer)
      break;
    case 'OSM_TRANSIT':
    case 'OSM_RECYCLING':
    case 'OSM_GREEN':
      baseMinutes = 3; // Umgebung: +3 Min. (bei 45 Min. Suchdauer)
      break;
    default:
      baseMinutes = Math.round(
        QUESTION_PENALTY_MS[QUESTION_CATEGORY_MAP[questionType]] / 60_000
      );
      break;
  }
  return scalePenaltyMinutes(baseMinutes, searchDurationMs);
}

export const MEDIA_RESPONSE_TIMEOUT_NET_MS = 5 * 60_000; // 5 Min. (300s) Netto-Spielzeit zum Senden eines Fotos
export const MEDIA_REFUND_MS = 10 * 60_000; // -10 Min. Zeitabzug bei Nicht-Senden innerhalb von 5 Min. (oder Ablehnung) bei 45 Min. Standard-Suchdauer

export function getMediaRefundMs(searchDurationMs?: number): number {
  return getQuestionPenaltyMs('MEDIA_SKY', searchDurationMs) * 2;
}
export const MEDIA_AUTO_EXPIRE_MS = 10 * 60_000; // Empfangene Fotos verschwinden automatisch nach 10 Min.
export const MEDIA_POST_DOWNLOAD_EXPIRE_MS = 60_000; // Nach Klick auf Download verkürzt sich die Restzeit auf max. 1 Min.

export const LEASH_RADIUS_METERS = 50;
export const LEASH_REQUIRED_ACCURACY_METERS = 25;
export const LEASH_CONSECUTIVE_VIOLATIONS = 3;
export const LEASH_RETURN_COUNTDOWN_MS = 60_000;

export const ANCHOR_ACCURACY_WARNING_METERS = 35;
export const ANCHOR_MANUAL_ADJUST_MAX_METERS = 50;

export const LOCATION_THROTTLE_INTERVAL_MS = 6_000;
export const LOCATION_MIN_DISTANCE_METERS = 25;

export const CONTROLLER_HEARTBEAT_INTERVAL_MS = 5_000;
export const CONTROLLER_LEASE_TTL_MS = 15_000;

export const TEAM_PALETTE = [
  { id: 'team-1', name: 'Team 1 (Bernstein)', color: '#f59e0b' },
  { id: 'team-2', name: 'Team 2 (Violett)', color: '#a855f7' },
  { id: 'team-3', name: 'Team 3 (Kobalt)', color: '#3b82f6' },
  { id: 'team-4', name: 'Team 4 (Magenta)', color: '#ec4899' },
  { id: 'team-5', name: 'Team 5 (Smaragd)', color: '#10b981' },
  { id: 'team-6', name: 'Team 6 (Koralle)', color: '#f97316' },
] as const;

export const PLAYER_SEAT_HEARTBEAT_MS = 10_000;
export const PLAYER_SEAT_TTL_MS = 28_000;
export const TEAM_MEMBER_FIX_MAX_AGE_MS = 5 * 60_000;

export function createDefaultTeams(): Record<string, TeamPublic> {
  const result: Record<string, TeamPublic> = {};
  for (const t of TEAM_PALETTE) {
    result[t.id] = {
      id: t.id,
      name: t.name,
      color: t.color,
      memberPlayerIds: [],
      beaconPlayerId: null,
      status: 'ACTIVE',
      penaltyMs: 0,
      catchTimestampMs: null,
      clueCount: 0,
    };
  }
  return result;
}

export function createDefaultPublicState(
  sessionId: string,
  existingConfirmedPlayArea?: PublicGameState['playArea']
): PublicGameState {
  return {
    status: 'LOBBY',
    currentPhase: 'LOBBY',
    gameMode: 'CLASSIC',
    classicSearchDurationMs: DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000,
    manhuntShrinkDurationMs: DEFAULT_MANHUNT_SHRINK_MINUTES * 60_000,
    gameStartTimestamp: null,
    searchStartTimestamp: null,
    pausedAt: null,
    totalPausedMs: 0,
    pausedBeforeSearchMs: 0,
    sessionId,
    anchorLocked: false,
    radarCircle: null,
    radarSchedule: { ...DEFAULT_RADAR_SCHEDULE },
    playArea:
      existingConfirmedPlayArea && !isLegacyPlaceholderPlayArea(existingConfirmedPlayArea)
        ? existingConfirmedPlayArea
        : {
            polygon: structuredClone(DEFAULT_PLAY_AREA_FEATURE),
            confirmed: true,
            confirmedAt: Date.now(),
            confirmedByUid: 'osm_official_81247',
            name: OFFICIAL_81247_AREA_NAME,
            postalCode: DEFAULT_POSTAL_CODE,
            shapeType: 'OFFICIAL_81247',
            circle: null,
          },
    safetyPoint: { ...DEFAULT_SAFETY_POINT },
    emergencyStopReason: null,
    allowTestClicks: false,
    leashAlertActive: false,
    activeTeamIds: TEAM_PALETTE.map((t) => t.id),
  };
}
