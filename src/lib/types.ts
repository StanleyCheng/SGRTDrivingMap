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

/**
 * The nine driver-facing overlays, in panel priority order. The first four are
 * live LTA/PUB road-condition feeds; 5–9 are the route-aware extras (parking,
 * ERP, EV charging, safety zones and expressway advisories).
 */
export type RoadLayerId =
  | "traffic-speed"
  | "incidents"
  | "hazards"
  | "roadworks"
  | "parking"
  | "erp"
  | "ev"
  | "zones"
  | "expressway";

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
  | "road-opening"
  /** One carpark's live lot availability, by vehicle type. */
  | "parking-lot"
  /** One official ERP gantry (zone + charge when the rate table is published). */
  | "erp-gantry"
  /** One ERP zone's current/next charge window from the official rate table. */
  | "erp-rate"
  /** One publicly accessible EV charging location with live availability. */
  | "ev-charger"
  /** A demarcated school zone (40 km/h). */
  | "school-zone"
  /** A demarcated silver zone (30/40 km/h). */
  | "silver-zone"
  /** One expressway segment's estimated travel time. */
  | "travel-time"
  /** A message currently displayed on an EMAS signboard. */
  | "emas-message";

export type RoadPosition = [lng: number, lat: number];

export type RoadConditionGeometry =
  | { type: "Point"; coordinates: RoadPosition }
  | { type: "LineString"; coordinates: RoadPosition[] }
  | { type: "Polygon"; coordinates: RoadPosition[][] };

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

    /* ---- parking (LTA Carpark Availability + HDB carpark information) ---- */
    /** Live lots available at the moment of retrieval. */
    availableLots?: number;
    /** LTA lot type: C (cars), H (heavy vehicles), Y (motorcycles). */
    lotType?: string;
    /** Published gantry/height limit in metres (HDB carpark information). */
    gantryHeightM?: number;
    /** Carpark development / block name. */
    development?: string;
    /** Planning area, when the source publishes one. */
    area?: string;

    /* ---- ERP ---- */
    /** Official zone id (e.g. AY1) used by LTA's rate table. */
    zoneId?: string;
    /** Vehicle class the charge applies to. */
    vehicleType?: string;
    /** Charge in SGD for the current operational window, when published. */
    charge?: number;
    /** Current operational window, e.g. "07:00–07:30". */
    chargeWindow?: string;
    /** Charge for the next operational window, when published. */
    nextCharge?: number;
    /** Next operational window, e.g. "07:30–08:00". */
    nextWindow?: string;
    /** Gantry height-limit value carried by the official gantry layer. */
    heightLimitM?: number;

    /* ---- EV charging ---- */
    /** Connector standard, e.g. "Type 2". */
    plugType?: string;
    /** Published power rating in kW — the value the live feed reports. */
    powerRatingKw?: number;
    /** Published charging speed in kW, when the feed supplies it separately. */
    chargingSpeedKw?: number;
    /** Charging operator. */
    operatorName?: string;
    /** Charging points available right now. */
    availablePoints?: number;
    /** Charging points at this location in total. */
    totalPoints?: number;

    /* ---- school / silver zones ---- */
    /** Published zone classification. */
    zoneType?: string;
    /** Statutory zone speed limit, sourced from the Road Traffic Act. */
    speedLimitKmh?: number;

    /* ---- expressway travel times + EMAS ---- */
    /** Expressway name, e.g. AYE. */
    corridor?: string;
    /** Estimated travel time in minutes for this segment. */
    estMinutes?: number;
    /** "east to west" / "west to east" per LTA's Direction code. */
    directionLabel?: string;
    /** Segment start / end / ultimate end points as published. */
    startPoint?: string;
    endPoint?: string;
    farEndPoint?: string;
    /** EMAS signboard equipment id. */
    equipmentId?: string;
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
  | "road-opening"
  | "carpark-availability"
  | "carpark-info"
  | "erp-gantry"
  | "erp-rates"
  | "ev-charging"
  | "school-zone"
  | "silver-zone"
  | "travel-time"
  | "emas";

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

/**
 * Property filters for the route-aware layers (5–8). `null` means "no filter",
 * and the same object is applied to the map and to the layer panel so the two
 * can never disagree.
 */
export interface LayerFilters {
  /** Parking: LTA lot type code — C (cars), H (heavy vehicles), Y (motorcycles). */
  lotType: string | null;
  /** EV charging: connector standard, e.g. "Type 2". */
  plugType: string | null;
  /** EV charging: only show locations rated at or above this many kW. */
  minPowerKw: number | null;
  /** EV charging: hide locations with no free point right now. */
  availableOnly: boolean;
}

export const DEFAULT_LAYER_FILTERS: LayerFilters = {
  lotType: null,
  plugType: null,
  minPowerKw: null,
  availableOnly: false,
};
