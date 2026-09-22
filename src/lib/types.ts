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

/** The four driver-facing live road-condition overlays. */
export type RoadLayerId = "traffic-speed" | "incidents" | "hazards" | "roadworks";

/** One upstream feed represented within a road-condition layer. */
export type RoadConditionKind =
  | "speed-band"
  /** LTA "Heavy Traffic" alerts — live congestion, mapped to the speed layer. */
  | "congestion-alert"
  | "accident"
  | "breakdown"
  | "obstruction"
  | "diversion"
  /** Any TrafficIncidents type LTA does not document — kept, never dropped. */
  | "incident"
  /** Live road works reported through TrafficIncidents (carries direction + lane). */
  | "live-roadwork"
  | "flood-alert"
  | "faulty-traffic-light"
  /** Approved road works permit register. */
  | "road-work"
  /** Planned road opening schedule. */
  | "road-opening";

export type RoadPosition = [lng: number, lat: number];

export type RoadConditionGeometry =
  | { type: "Point"; coordinates: RoadPosition }
  | { type: "LineString"; coordinates: [RoadPosition, RoadPosition] };

/**
 * A GeoJSON-compatible road-condition feature. Some official LTA feeds do not
 * publish coordinates, and invalid/out-of-Singapore coordinates are rejected;
 * those records use `geometry: null` rather than a fabricated map position.
 */
export interface RoadConditionFeature {
  type: "Feature";
  id: string;
  geometry: RoadConditionGeometry | null;
  properties: {
    layer: RoadLayerId;
    kind: RoadConditionKind;
    title: string;
    description?: string;
    road?: string;
    sourceId: string;
    /** Official upstream severity, when the source publishes one (flood alerts). */
    severity?: string;
    startsAt?: string;
    endsAt?: string;
    speedBand?: number;
    minimumSpeed?: number;
    maximumSpeed?: number;
    /** DataMall category code (v4 uses numeric-looking strings; older feeds used A–G). */
    roadCategory?: string;
    radiusKm?: number;
    agency?: string;
    /** Route the alert affects, parsed from LTA's own message wording. */
    route?: string;
    /** Travel direction, e.g. "towards Tuas" — LTA wording, not inferred. */
    direction?: string;
    /** Landmark reference LTA gives, e.g. "after Mandai Rd". */
    landmark?: string;
    /** Affected lane, only where LTA publishes it ("Avoid lane 2"). */
    lane?: string;
    /** LTA's own timestamp text, shown verbatim rather than date-parsed. */
    reportedText?: string;
  };
}

/** One upstream DataMall feed. Distinct from a feature kind: after routing, the
 * TrafficIncidents feed emits several different kinds across three layers. */
export type RoadConditionSourceId =
  | "speed-band"
  | "traffic-incident"
  | "flood-alert"
  | "faulty-traffic-light"
  | "road-work"
  | "road-opening";

export interface RoadConditionSourceStatus {
  id: RoadConditionSourceId;
  name: string;
  url: string;
  status: SourceStatus;
  count: number;
  mappedCount: number;
  /** Records the upstream feed published, before any drawing scope was applied. */
  upstreamCount?: number;
  /** ISO timestamp of the most recent successful fetch. */
  fetchedAt?: string;
  error?: string;
}

export interface RoadConditionLayerInfo {
  id: RoadLayerId;
  count: number;
  mappedCount: number;
  status: SourceStatus;
  sources: RoadConditionSourceStatus[];
  error?: string;
}

export interface RoadConditionsResponse {
  generatedAt: string;
  status: SourceStatus;
  /** True when at least one source was served from its local cache. */
  fromCache: boolean;
  layers: RoadConditionLayerInfo[];
  features: RoadConditionFeature[];
  error?: string;
}
