/// <reference types="vite/client" />

declare module '*.geojson' {
  import type { Feature, Polygon } from 'geojson';
  const value: Feature<Polygon>;
  export default value;
}
