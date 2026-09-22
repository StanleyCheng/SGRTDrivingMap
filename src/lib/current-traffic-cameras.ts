import type {
  CameraPoint,
  CamerasResponse,
  TrafficCamera,
  TrafficImagesResponse,
} from "./types";

function toPoint(camera: TrafficCamera): CameraPoint {
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
 * Make the public Traffic Images feed the sole source of snapshot markers.
 * The separate LTA Road Camera dataset is an illegal-parking camera inventory
 * and does not publish images.
 */
export function withCurrentTrafficCameras(
  base: CamerasResponse,
  traffic: TrafficImagesResponse | null,
): CamerasResponse {
  const snapshotPoints = (traffic?.cameras ?? []).map(toPoint);
  const points = [...base.points.filter((point) => point.layer !== "snapshot"), ...snapshotPoints];
  const layers = base.layers.map((layer) =>
    layer.id === "snapshot"
      ? {
          ...layer,
          sources: layer.sources.filter(
            (source) =>
              !source.url.includes("d_147f4906651f5b32925dfe6560296161") &&
              !source.name.includes("Road Camera locations"),
          ),
          count: snapshotPoints.length,
          liveCount: snapshotPoints.length,
          status: traffic?.status ?? layer.status,
          error: traffic?.error,
          kinds: { snapshot: snapshotPoints.length },
        }
      : layer,
  );

  return { ...base, points, layers };
}
