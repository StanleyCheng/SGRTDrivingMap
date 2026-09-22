import { getLiveLayers } from "@/lib/server/live-layers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Refreshes are governed exclusively by server-side source TTLs. Do not
  // expose a public query parameter that bypasses the upstream caches.
  const data = await getLiveLayers();
  // `?layers=` narrows the feature list to the layers the browser has switched
  // on; an empty value means "none switched on". Counts and feed health always
  // stay complete, and no parameter at all returns every feature.
  const requested = new URL(request.url).searchParams.get("layers");
  const wanted =
    requested === null
      ? null
      : new Set(requested.split(",").map((value) => value.trim()).filter(Boolean));
  const payload = wanted
    ? { ...data, features: data.features.filter((feature) => wanted.has(feature.properties.layer)) }
    : data;
  return Response.json(payload, {
    headers: {
      "cache-control":
        data.status !== "ok" ? "no-store" : "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
