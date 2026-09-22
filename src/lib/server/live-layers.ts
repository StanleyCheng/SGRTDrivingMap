import type { RoadConditionsResponse, RoadLayerId } from "../types";
import { aggregateStatus, buildLayer, featuresForClient, loadSources } from "./feeds";
import { MOBILITY_LAYERS, MOBILITY_SOURCES } from "./mobility";
import { ROAD_CONDITION_LAYERS, ROAD_CONDITION_SOURCES } from "./road-conditions";

/**
 * The single aggregation point for every driver-facing overlay.
 *
 * All nine layers are read through one request so the browser polls one endpoint
 * and one set of upstream TTLs applies. Feed health is reported per layer, and a
 * single failing upstream never blanks the map.
 */
const SOURCES = [...ROAD_CONDITION_SOURCES, ...MOBILITY_SOURCES];

export const LIVE_LAYER_IDS: RoadLayerId[] = [...ROAD_CONDITION_LAYERS, ...MOBILITY_LAYERS];

export async function getLiveLayers(): Promise<RoadConditionsResponse> {
  const loaded = await loadSources(SOURCES);
  const layers = LIVE_LAYER_IDS.map((id) => buildLayer(id, SOURCES, loaded));
  const status = aggregateStatus(layers.map((layer) => layer.status));
  const errors = layers.flatMap((layer) => (layer.error ? [layer.error] : []));
  return {
    generatedAt: new Date().toISOString(),
    status,
    fromCache: loaded.some((source) => source.fromCache),
    layers,
    // Only features that can be drawn or listed are sent: the layer counts above
    // stay exact, but the ~10k permit records with no published coordinates no
    // longer cost megabytes of JSON on every poll.
    features: featuresForClient(loaded),
    error: errors.length ? [...new Set(errors)].join("; ") : undefined,
  };
}
