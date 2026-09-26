// The one place the app imports maplibre-gl from.
//
// maplibre-gl 6 ships ESM only and loads its tile worker from a separate
// file. Under a bundler it cannot find that file by itself: without the
// setWorkerUrl() call below the map frame renders but no vector tile ever
// loads, and nothing throws. `?worker&url` (not plain `?url`) makes Vite
// emit the worker as one self-contained chunk; the raw dist file imports a
// sibling that `?url` would leave behind. See maplibre's v5 to v6
// migration guide.
//
// Importing maplibre-gl directly elsewhere skips this, so both maps import
// from here. The CSS stays global in main.jsx.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

// Map styles here reference icons their sprite sheet lacks (OpenFreeMap
// Liberty omits swimming_pool, bollard, gate, office, …). A transparent 1×1
// stand-in keeps MapLibre from warning on every repaint without changing
// what renders; those icons were invisible anyway. In v6 the
// `styleimagemissing` event is notify-only, so this has to be a resolver.
export function silenceMissingSpriteIcons(map) {
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id)) return;
    map.addImage(id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
  });
}

export default maplibregl;
