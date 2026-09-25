import type { CameraKind, LayerId, RoadLayerId } from "./types";

/**
 * The static GitHub Pages build has no server, so it reads LTA's live image feed
 * from the keyless data.gov.sg mirror instead of the DataMall API. Attribute the
 * source the running build actually uses.
 */
const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

export interface LayerDef {
  id: LayerId;
  /** CSS var holding the marker colour. */
  color: string;
  /** Order in the panel + legend. */
  order: number;
  /** Sub-types that belong to this layer, in display order. */
  kinds: CameraKind[];
  /** Full description used in the sources panel. */
  source: {
    agency: string;
    agencyZh: string;
    dataset: string;
    datasetZh: string;
    url: string;
  }[];
}

export const LAYERS: LayerDef[] = [
  {
    id: "redlight",
    color: "var(--c-redlight)",
    order: 1,
    kinds: ["redlight"],
    source: [
      {
        agency: "Singapore Police Force",
        agencyZh: "新加坡警察部隊",
        dataset: "Red Light Cameras (RLC)",
        datasetZh: "紅燈攝影機（RLC）",
        url: "https://data.gov.sg/datasets/d_5f140c79c9dbee0bbb07c753afd788d8/view",
      },
      {
        agency: "Singapore Police Force",
        agencyZh: "新加坡警察部隊",
        dataset: "Digital Traffic Red Light Cameras (DTRLS)",
        datasetZh: "數碼交通紅燈攝影機（DTRLS）",
        url: "https://data.gov.sg/datasets/d_0b7ddc0979dfc183e8b0e056878b14af/view",
      },
    ],
  },
  {
    id: "speed",
    color: "var(--c-speed)",
    order: 2,
    kinds: ["fixed_speed", "expressway_speed", "laser_speed", "mobile_speed"],
    source: [
      {
        agency: "Singapore Police Force",
        agencyZh: "新加坡警察部隊",
        dataset: "Fixed Speed Cameras (FSC)",
        datasetZh: "固定式超速攝影機（FSC）",
        url: "https://data.gov.sg/datasets/d_5fdeb9dccf757dbdf698240fed29f441/view",
      },
      {
        agency: "Singapore Police Force",
        agencyZh: "新加坡警察部隊",
        dataset: "Location of Speed Cameras in Singapore (consolidated list)",
        datasetZh: "新加坡測速攝影機位置（綜合名單）",
        url: "https://data.gov.sg/datasets/d_983804de2bc016f53e44031d85d1ec8a/view",
      },
      {
        agency: "Singapore Police Force",
        agencyZh: "新加坡警察部隊",
        dataset: "Police Speed Laser Cameras (PSLC)",
        datasetZh: "警方雷射測速攝影機（PSLC）",
        url: "https://data.gov.sg/datasets/d_763b60398a7749f793f1eae2fe97c775/view",
      },
      {
        agency: "Singapore Police Force",
        agencyZh: "新加坡警察部隊",
        dataset: "Mobile Speed Cameras (MSC)",
        datasetZh: "流動測速攝影機（MSC）",
        url: "https://data.gov.sg/datasets/d_e411f01a5ac504f88434d7a02388c9ce/view",
      },
    ],
  },
  {
    id: "snapshot",
    color: "var(--c-snapshot)",
    order: 3,
    kinds: ["snapshot"],
    source: [
      {
        agency: "Land Transport Authority",
        agencyZh: "陸路交通管理局",
        dataset: STATIC_MODE
          ? "Traffic Images (live stills, data.gov.sg)"
          : "Traffic Images (live stills, DataMall)",
        datasetZh: STATIC_MODE ? "交通影像（實時畫面，data.gov.sg）" : "交通影像（實時畫面，DataMall）",
        url: STATIC_MODE
          ? "https://data.gov.sg/datasets/d_6cdb6b405b25aaaacbaf7689bcc6fae0/view"
          : "https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html",
      },
    ],
  },
];

export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

/**
 * Every driver-facing overlay, in panel priority order, with the CSS variable
 * that carries its signal colour. Colour is always paired with a distinct
 * glyph, so hue is never the only way to tell two layers apart.
 *
 * This registry is the single source of truth: the ordered id list, the colour
 * map, the default view, the live/route split and the MapLibre layer ids per
 * overlay are all derived from it, so adding a layer is one entry here.
 */
export interface RoadLayerDefinition {
  id: RoadLayerId;
  /** CSS custom property holding the signal colour. */
  color: string;
  /** Panel group: the live road conditions lead, the route extras follow. */
  group: "live" | "route";
  /** Driver layers 1-2 carry the default view; the other seven start off. */
  defaultOn: boolean;
  /** MapLibre layer ids this overlay owns, in draw order. */
  drawLayers: string[];
}

export const ROAD_LAYERS: RoadLayerDefinition[] = [
  {
    id: "traffic-speed",
    color: "var(--c-traffic)",
    group: "live",
    defaultOn: true,
    drawLayers: [
      "road-traffic-speed-casing",
      "road-traffic-speed-line",
      "road-traffic-speed-hit",
      "road-traffic-speed-points",
    ],
  },
  {
    id: "incidents",
    color: "var(--c-incident)",
    group: "live",
    defaultOn: true,
    drawLayers: ["road-incidents-points", "road-incidents-hit"],
  },
  {
    id: "hazards",
    color: "var(--c-hazard)",
    group: "live",
    defaultOn: false,
    drawLayers: ["road-hazards-points", "road-hazards-hit"],
  },
  {
    id: "roadworks",
    color: "var(--c-roadworks)",
    group: "live",
    defaultOn: false,
    drawLayers: ["road-roadworks-points", "road-roadworks-hit"],
  },
  {
    id: "parking",
    color: "var(--c-parking)",
    group: "route",
    defaultOn: false,
    drawLayers: ["road-parking-points", "road-parking-hit"],
  },
  {
    id: "erp",
    color: "var(--c-erp)",
    group: "route",
    defaultOn: false,
    drawLayers: ["road-erp-casing", "road-erp-line", "road-erp-hit"],
  },
  {
    id: "ev",
    color: "var(--c-ev)",
    group: "route",
    defaultOn: false,
    drawLayers: ["road-ev-points", "road-ev-hit"],
  },
  {
    id: "zones",
    color: "var(--c-zones)",
    group: "route",
    defaultOn: false,
    drawLayers: [
      "road-zones-fill",
      "road-zones-outline",
      "road-zones-pin",
      "road-zones-label",
      "road-zones-hit",
    ],
  },
  {
    id: "expressway",
    color: "var(--c-expressway)",
    group: "route",
    defaultOn: false,
    drawLayers: ["road-expressway-points", "road-expressway-hit"],
  },
];

function keyedByRoadLayer<T>(pick: (def: RoadLayerDefinition) => T): Record<RoadLayerId, T> {
  return Object.fromEntries(ROAD_LAYERS.map((def) => [def.id, pick(def)])) as Record<
    RoadLayerId,
    T
  >;
}

/** Compile-time guard: a new `RoadLayerId` must be given a registry entry. */
const EVERY_ROAD_LAYER_DECLARED: Record<RoadLayerId, true> = keyedByRoadLayer(() => true);
void EVERY_ROAD_LAYER_DECLARED;

/** Panel priority order. */
export const ROAD_LAYER_ORDER: RoadLayerId[] = ROAD_LAYERS.map((def) => def.id);

/** Signal colour per overlay. */
export const ROAD_LAYER_COLOR: Record<RoadLayerId, string> = keyedByRoadLayer((def) => def.color);

/** The default view: only the first two driver layers are on. */
export const ROAD_LAYER_DEFAULTS: Record<RoadLayerId, boolean> = keyedByRoadLayer(
  (def) => def.defaultOn,
);

/** MapLibre layer ids per overlay, for visibility toggling. */
export const ROAD_DRAW_LAYERS: Record<RoadLayerId, string[]> = keyedByRoadLayer(
  (def) => def.drawLayers,
);

/** The four live road-condition overlays, in panel order. */
export const LIVE_ROAD_LAYER_IDS: RoadLayerId[] = ROAD_LAYERS.filter(
  (def) => def.group === "live",
).map((def) => def.id);

/**
 * Official documentation surfaced by the route-aware overlays. Kept here (not
 * in a server module) so client components can link to them directly.
 */
export const DOC_LINKS = {
  datamallGuide:
    "https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf",
  erpRates:
    "https://onemotoring.lta.gov.sg/content/onemotoring/home/driving/ERP/ERP.html",
  hdbCarparkInfo: "https://data.gov.sg/datasets/d_23f946fa557947f93a8043bbef41dd09/view",
  ltaGantry: "https://data.gov.sg/datasets/d_753090823cc9920ac41efaa6530c5893/view",
  schoolZone: "https://data.gov.sg/datasets/d_abf023b38d9bc451484e3d67b562bc5c/view",
  silverZone: "https://data.gov.sg/datasets/d_dc343c021aa470fc71da90d31e552a9a/view",
} as const;

export function layerColor(id: LayerId) {
  return LAYER_BY_ID.get(id)?.color ?? "var(--ink)";
}

export function kindColor(kind: CameraKind): string {
  switch (kind) {
    case "redlight":
      return "var(--c-redlight)";
    case "snapshot":
      return "var(--c-snapshot)";
    default:
      return "var(--c-speed)";
  }
}
