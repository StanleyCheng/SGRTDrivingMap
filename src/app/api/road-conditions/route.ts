import { getRoadConditions } from "@/lib/server/road-conditions";

export const dynamic = "force-dynamic";

export async function GET() {
  // Refreshes are governed exclusively by server-side source TTLs. Do not
  // expose a public query parameter that bypasses all six upstream caches.
  const data = await getRoadConditions();
  return Response.json(data, {
    headers: {
      "cache-control":
        data.status !== "ok" ? "no-store" : "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
