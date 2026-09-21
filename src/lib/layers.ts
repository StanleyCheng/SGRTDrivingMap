import type { CameraKind, LayerId } from "./types";

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
        dataset: "LTA Road Camera (locations)",
        datasetZh: "陸交局道路攝影機（位置）",
        url: "https://data.gov.sg/datasets/d_147f4906651f5b32925dfe6560296161/view",
      },
      {
        agency: "Land Transport Authority",
        agencyZh: "陸路交通管理局",
        dataset: "Traffic Images (live stills, DataMall)",
        datasetZh: "交通影像（實時畫面，DataMall）",
        url: "https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html",
      },
    ],
  },
];

export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

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
