import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import transitStopsGeoJson from './transitStops81247.geojson';
import type { LatLng } from '../types/game';

export interface CuratedTransitStop {
  id: string;
  name: string;
  kind: 'S-Bahn' | 'Bus';
  lat: number;
  lng: number;
}

interface TransitStopProperties {
  '@id'?: string;
  name?: string;
  railway?: string;
  highway?: string;
}

const rawTransitCollection =
  transitStopsGeoJson as unknown as FeatureCollection<Point, TransitStopProperties>;

/**
 * Vollständiger Satz aller 45 Overpass-ÖPNV-Haltestellen in & direkt an 81247 München
 * (Bussteige + S-Bahnhof Obermenzing aus export.geojson).
 */
export const FALLBACK_TRANSIT_STOPS_81247: CuratedTransitStop[] = (
  rawTransitCollection.features ?? []
)
  .filter((f) => f.geometry?.type === 'Point' && f.geometry.coordinates.length >= 2)
  .map((f, idx) => {
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties ?? {};
    const kind: 'S-Bahn' | 'Bus' = props.railway ? 'S-Bahn' : 'Bus';
    const baseName = props.name?.trim() || `Haltestelle ${idx + 1}`;
    return {
      id: String(f.id ?? props['@id'] ?? `stop-${idx + 1}`),
      name: baseName,
      kind,
      lat,
      lng,
    };
  });

/**
 * Echte, kuratierte Grünanlagen & Parks in 81247 München
 * (Schlosspark Blutenburg, Würm-Grünzug, Durchblickpark, Grünzug Carl-Orff-Bogen).
 */
export const FALLBACK_GREEN_POLYGONS_81247: Feature<Polygon>[] = [
  {
    type: 'Feature',
    properties: {
      id: 'green-blutenburg',
      name: 'Schlosspark Blutenburg & Schlossweiher-Aue',
      leisure: 'park',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [11.4545, 48.1652],
          [11.4608, 48.1655],
          [11.4614, 48.1615],
          [11.4549, 48.1611],
          [11.4545, 48.1652],
        ],
      ],
    },
  },
  {
    type: 'Feature',
    properties: {
      id: 'green-durchblickpark',
      name: 'Durchblickpark Obermenzing / Pipping',
      leisure: 'park',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [11.4508, 48.1648],
          [11.4552, 48.1649],
          [11.4562, 48.1588],
          [11.4512, 48.1585],
          [11.4508, 48.1648],
        ],
      ],
    },
  },
  {
    type: 'Feature',
    properties: {
      id: 'green-wuerm-korridor',
      name: 'Würm-Grünzug (Pipping – Blutenburg – Obermenzing)',
      leisure: 'park',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [11.4582, 48.1745],
          [11.4628, 48.1742],
          [11.4618, 48.1655],
          [11.4602, 48.1562],
          [11.4568, 48.1564],
          [11.4578, 48.1656],
          [11.4582, 48.1745],
        ],
      ],
    },
  },
  {
    type: 'Feature',
    properties: {
      id: 'green-carl-orff-park',
      name: 'Grünanlage Carl-Orff-Bogen / Verdistraße',
      leisure: 'park',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [11.4685, 48.1652],
          [11.4735, 48.1651],
          [11.4733, 48.1628],
          [11.4683, 48.1629],
          [11.4685, 48.1652],
        ],
      ],
    },
  },
  {
    type: 'Feature',
    properties: {
      id: 'green-allacher-waldrand',
      name: 'Grünzug Nord / Mühlanger',
      landuse: 'forest',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [11.4625, 48.1772],
          [11.4748, 48.1768],
          [11.4745, 48.1736],
          [11.4622, 48.1739],
          [11.4625, 48.1772],
        ],
      ],
    },
  },
];

export function getFallbackTransitLatLngs81247(): LatLng[] {
  return FALLBACK_TRANSIT_STOPS_81247.map((s) => ({ lat: s.lat, lng: s.lng }));
}
