"use client";

import type { CSSProperties } from "react";
import type { StringKey } from "@/lib/i18n";
import { ROAD_LAYERS as ROAD_LAYER_REGISTRY, ROAD_LAYER_ORDER } from "@/lib/layers";
import type { LayerId, RoadLayerId, SourceStatus } from "@/lib/types";

/**
 * Presentation primitives shared by the desktop layer list and the phone rail:
 * the layer registry, marker glyphs and the switch control.
 *
 * Layer colours are double-encoded — every layer also has its own glyph — so
 * hue is never the only signal.
 */

export interface RoadLayerDef {
  id: RoadLayerId;
  color: string;
  /** Presentation group in the panel: the live feed stack, or the route extras. */
  group: "live" | "route";
}

/**
 * Panel order and grouping come straight from the shared registry, so the rail
 * cannot drift from the layers the map actually draws.
 */
export const ROAD_LAYERS: RoadLayerDef[] = ROAD_LAYER_REGISTRY.map(({ id, color, group }) => ({
  id,
  color,
  group,
}));

export const LIVE_ROAD_LAYERS = ROAD_LAYERS.filter((layer) => layer.group === "live");
export const ROUTE_ROAD_LAYERS = ROAD_LAYERS.filter((layer) => layer.group === "route");

export const ROAD_LAYER_IDS: RoadLayerId[] = ROAD_LAYER_ORDER;

export const UNIT: Record<LayerId, StringKey> = {
  redlight: "common.locations",
  speed: "common.locations",
  snapshot: "common.cameras",
};

export const STATUS_STYLE: Record<Exclude<SourceStatus, "ok">, { key: StringKey; color: string }> = {
  error: { key: "status.error", color: "var(--err)" },
  partial: { key: "status.partial", color: "var(--warn)" },
  stale: { key: "status.stale", color: "var(--warn)" },
};

/** Written-out LTA lot type codes (C/H/Y) for the parking cards. */
export const LOT_TYPE_KEYS: Record<string, StringKey> = {
  C: "lotType.C",
  H: "lotType.H",
  Y: "lotType.Y",
};

export function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <path d="M6 3.4 L11.6 13.2 H0.4 Z" fill="none" stroke="var(--c-speed)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="7.6" y="7.4" width="9.4" height="9.4" rx="2.2" fill="none" stroke="var(--c-snapshot)" strokeWidth="1.5" />
      <circle cx="6.4" cy="12.4" r="2.8" fill="var(--c-redlight)" />
    </svg>
  );
}

export function Glyph({ id, color, size = 20 }: { id: LayerId; color: string; size?: number }) {
  const common = { fill: "none", stroke: color, strokeWidth: 2.1 } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      {id === "redlight" && (
        <>
          <circle cx="10" cy="10" r="6" {...common} />
          <circle cx="10" cy="10" r="2" fill={color} />
        </>
      )}
      {id === "speed" && <path d="M10 3.4 L17 16.4 H3 Z" {...common} strokeLinejoin="round" />}
      {id === "snapshot" && (
        <>
          <rect x="3" y="4.6" width="14" height="10.8" rx="2.4" {...common} />
          <circle cx="10" cy="10" r="2.2" fill={color} />
        </>
      )}
    </svg>
  );
}

/**
 * One glyph per driver-facing layer. Shapes differ by meaning: flowing bands for
 * congestion, a warning triangle for incidents, a hazard diamond, a barrier for
 * works, a P for parking, a gantry arch for ERP, a plug for charging, a shield
 * for the safety zones and a clock for travel times.
 */
export function RoadGlyph({ id, size = 20 }: { id: RoadLayerId; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {id === "traffic-speed" && (
        <>
          <path d="M2 5.5h16M2 10h16M2 14.5h16" />
          <path d="M5 3.5v4M10 8v4M15 12.5v4" opacity=".45" />
        </>
      )}
      {id === "incidents" && (
        <>
          <path d="M10 2.5 18 17H2L10 2.5Z" />
          <path d="M10 7v4.5M10 14.2v.1" />
        </>
      )}
      {id === "hazards" && (
        <>
          <path d="M10 1.8 18.2 10 10 18.2 1.8 10 10 1.8Z" />
          <path d="M10 5.8v5.2M10 14v.1" />
        </>
      )}
      {id === "roadworks" && (
        <>
          <path d="M3 6.5h14v7H3zM5.5 6.5l3 7M11.5 6.5l3 7M5 13.5 3.8 18M15 13.5l1.2 4.5" />
        </>
      )}
      {id === "parking" && (
        <>
          <rect x="3" y="3" width="14" height="14" rx="3.6" />
          <path d="M8.2 14V6.2h2.9a2.4 2.4 0 0 1 0 4.8H8.2" />
        </>
      )}
      {id === "erp" && (
        <>
          <path d="M3.6 15.6V8.4a1.2 1.2 0 0 1 1.2-1.2h10.4a1.2 1.2 0 0 1 1.2 1.2v7.2" />
          <path d="M2.4 15.6h15.2" />
          <circle cx="10" cy="9.6" r="2" />
          <path d="M10 7.8v3.6" />
        </>
      )}
      {id === "ev" && (
        <>
          <rect x="3.2" y="5.6" width="13.6" height="10" rx="2.8" />
          <path d="M11 7.4 8.3 11h3.1l-1.4 3.2" />
        </>
      )}
      {id === "zones" && (
        <>
          <path d="M10 2.6 17 5.4v4.7c0 3.5-2.9 6.2-7 7.3-4.1-1.1-7-3.8-7-7.3V5.4Z" />
          <circle cx="10" cy="9.6" r="2.5" />
          <path d="M8.2 9.6h3.6" />
        </>
      )}
      {id === "expressway" && (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 5.8V10l3 2" />
        </>
      )}
    </svg>
  );
}

/** A layer glyph for either registry, so callers do not branch on the id space. */
export function AnyLayerGlyph({
  id,
  color,
  size = 20,
}: {
  id: LayerId | RoadLayerId;
  color: string;
  size?: number;
}) {
  if (ROAD_LAYER_IDS.includes(id as RoadLayerId)) {
    return <RoadGlyph id={id as RoadLayerId} size={size} />;
  }
  return <Glyph id={id as LayerId} color={color} size={size} />;
}

export function layerStyle(color: string) {
  return { "--layer-color": color } as CSSProperties;
}

/** Small coloured badge used for counts and status inside layer cards. */
export function Chip({
  color,
  children,
  pulse = false,
}: {
  color: string;
  children: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {pulse && <span className="pulse h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}
