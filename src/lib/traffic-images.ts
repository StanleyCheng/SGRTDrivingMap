import { withoutRetiredCameras } from "./camera-snapshot";
import type {
  CameraKind,
  CameraPoint,
  CamerasResponse,
  LayerId,
  TrafficCamera,
  TrafficImagesResponse,
} from "./types";

/**
 * Official camera names published by LTA on OneMotoring, keyed by CameraID.
 * Pure data — shared by the server (DataMall feed) and the static build
 * (data.gov.sg mirror of the same feed).
 */
export const LTA_CAMERA_NAMES: Record<string, string> = {
  "2701": "Woodlands Causeway (towards Johor)",
  "2702": "Woodlands Checkpoint (towards BKE)",
  "2704": "Woodlands Flyover (towards Checkpoint)",
  "4703": "Second Link at Tuas",
  "4712": "After Tuas West Road",
  "4713": "Tuas Checkpoint",
  "4798": "Sentosa Gateway (towards Telok Blangah)",
  "4799": "Sentosa Gateway (towards Sentosa)",
};

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Normalise the keyless data.gov.sg mirror of LTA's traffic-image feed:
 * GET https://api.data.gov.sg/v1/transport/traffic-images  (CORS: *)
 */
export function normaliseDataGovTraffic(json: unknown): {
  feedTimestamp?: string;
  cameras: TrafficCamera[];
} {
  const item = (json as { items?: unknown[] })?.items?.[0] as
    | { timestamp?: string; cameras?: unknown[] }
    | undefined;
  const cameras: TrafficCamera[] = [];
  for (const raw of item?.cameras ?? []) {
    const c = raw as {
      camera_id?: string;
      image?: string;
      location?: { latitude?: number; longitude?: number };
      timestamp?: string;
    };
    const id = String(c.camera_id ?? "");
    const lat = Number(c.location?.latitude);
    const lng = Number(c.location?.longitude);
    if (!id || !c.image || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    cameras.push({
      cameraId: id,
      name: LTA_CAMERA_NAMES[id] ?? `LTA camera ${id}`,
      lat: round(lat),
      lng: round(lng),
      imageUrl: c.image,
      imageTime: c.timestamp ?? item?.timestamp ?? new Date().toISOString(),
    });
  }
  return { feedTimestamp: item?.timestamp, cameras };
}

/** Build the map point for one camera currently published by Traffic Images. */
export function trafficCameraPoint(camera: TrafficCamera): CameraPoint {
  return {
    id: `snapshot:${camera.cameraId}`,
    layer: "snapshot",
    kind: "snapshot",
    lat: camera.lat,
    lng: camera.lng,
    road: camera.name,
    ref: camera.cameraId,
    live: true,
  };
}

/**
 * Traffic Images is the sole source of snapshot markers. Camera locations in
 * the static/base payload deliberately do not participate: that prevents the
 * unrelated LTA Road Camera asset inventory from being presented as cameras
 * with public images, and lets a static Pages build follow feed changes live.
 */
export function withCurrentTrafficCameras(
  base: CamerasResponse,
  traffic: TrafficImagesResponse | null,
): CamerasResponse {
  const snapshotPoints = (traffic?.cameras ?? []).map(trafficCameraPoint);
  // A base payload — a bundled seed, or one cached before the inventory was
  // retired — still has to lose the cameras that publish no image, before the
  // live feed is merged in.
  const pruned = withoutRetiredCameras(base);
  const layers = pruned.layers.map((layer) => {
    if (layer.id !== "snapshot") return layer;
    return {
      ...layer,
      count: snapshotPoints.length,
      liveCount: snapshotPoints.length,
      status: traffic?.status ?? "ok",
      error: traffic?.error,
      kinds: { snapshot: snapshotPoints.length },
    };
  });
  return { ...pruned, layers, points: [...pruned.points, ...snapshotPoints] };
}

/** Point shape used by the LayerInfo.kinds map. */
export type KindCounts = Partial<Record<CameraKind, number>>;

export interface LayerInfoLike {
  id: LayerId;
  sources: { name: string; url: string; updatedAt?: string }[];
}

/**
 * The static (GitHub Pages) build has no server, so the live feed comes from the
 * keyless data.gov.sg mirror instead of LTA DataMall. Keep the attribution honest.
 */
export function retargetSourcesForStatic(layers: LayerInfoLike[]): LayerInfoLike[] {
  return layers.map((layer) => ({
    ...layer,
    sources: layer.sources.map((source) =>
      source.url.includes("datamall.lta.gov.sg")
        ? {
            ...source,
            name: "Land Transport Authority — Traffic Images (live stills, data.gov.sg)",
            url: "https://data.gov.sg/datasets/d_6cdb6b405b25aaaacbaf7689bcc6fae0/view",
          }
        : source,
    ),
  }));
}
