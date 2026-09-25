import type { CameraKind, CameraPoint, LayerId } from "./types";

/**
 * The snapshot layer is fed by the live Traffic Images feed alone, so only the
 * cameras that feed actually publishes may be drawn. Older bundled seeds mixed
 * in LTA's separate Road Camera inventory — cameras installed to deter illegal
 * parking, which publish no image at all — so every consumer of a payload has to
 * keep them out: the server's cached copy, the browser's copy and the static
 * bake. The rule lives here once so the three cannot drift apart.
 */
const RETIRED_ROAD_CAMERA_DATASET = "d_147f4906651f5b32925dfe6560296161";

interface SnapshotLayerShape {
  id: LayerId;
  sources: { url: string; name: string }[];
  count: number;
  liveCount?: number;
  kinds?: Partial<Record<CameraKind, number>>;
}

/**
 * Drop the retired inventory from a camera payload and restate the snapshot
 * layer's counts from the points that survived, so a stale seed can never
 * reintroduce 254 markers that have no image behind them.
 */
export function withoutRetiredCameras<
  T extends { points: CameraPoint[]; layers: L[] },
  L extends SnapshotLayerShape,
>(payload: T): T {
  const points = payload.points.filter((point) => point.layer !== "snapshot" || point.live);
  const snapshotCount = points.filter((point) => point.layer === "snapshot").length;
  const layers = payload.layers.map((layer) =>
    layer.id === "snapshot"
      ? {
          ...layer,
          sources: layer.sources.filter(
            (source) =>
              !source.url.includes(RETIRED_ROAD_CAMERA_DATASET) &&
              !source.name.includes("Road Camera locations"),
          ),
          count: snapshotCount,
          liveCount: snapshotCount,
          kinds: { snapshot: snapshotCount },
        }
      : layer,
  );
  return { ...payload, points, layers } as T;
}
