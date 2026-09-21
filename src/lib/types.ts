export type Lang = "en" | "zh";

/** One toggleable map layer. */
export type LayerId = "redlight" | "speed" | "snapshot";

/** Sub-type of a camera, used for badge + detail copy. */
export type CameraKind =
  | "redlight"
  | "fixed_speed"
  | "expressway_speed"
  | "laser_speed"
  | "mobile_speed"
  | "snapshot";

export type SourceStatus = "ok" | "stale" | "partial" | "error";

/** A single point plotted on the map. */
export interface CameraPoint {
  /** Stable unique key: `${kind}:${sourceId}`. */
  id: string;
  layer: LayerId;
  kind: CameraKind;
  lat: number;
  lng: number;
  road: string;
  /** Direction of travel / second road of the junction, when published. */
  direction?: string;
  /** Free-text descriptor published by the source. */
  desc?: string;
  /** Source record id (OBJECTID / UNIQUE_ID / LTA CameraID). */
  ref: string;
  /** Snapshot cameras only: camera has a live image right now. */
  live?: boolean;
}

export interface LayerSource {
  name: string;
  url: string;
  /** ISO timestamp of the upstream dataset revision, when published. */
  updatedAt?: string;
}

export interface LayerInfo {
  id: LayerId;
  /** One entry per upstream dataset that fed this layer. */
  sources: LayerSource[];
  count: number;
  liveCount?: number;
  status: SourceStatus;
  /** Set when status is not "ok" — plain-text reason shown to the user. */
  error?: string;
  /** Kind breakdown, e.g. { redlight: 240 } — drives the detail copy + legend. */
  kinds: Partial<Record<CameraKind, number>>;
}

export interface CamerasResponse {
  generatedAt: string;
  /** True when the payload came from a cached snapshot (upstream unreachable). */
  fromCache: boolean;
  layers: LayerInfo[];
  points: CameraPoint[];
}

export interface TrafficCamera {
  cameraId: string;
  name: string;
  lat: number;
  lng: number;
  imageUrl: string;
  /** ISO timestamp of the image itself (upstream). */
  imageTime: string;
}

export interface TrafficImagesResponse {
  generatedAt: string;
  /** Upstream feed timestamp. */
  feedTimestamp?: string;
  status: SourceStatus;
  error?: string;
  cameras: TrafficCamera[];
}
