import { getCameras } from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    const data = await getCameras({ force });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message, upstream: "data.gov.sg" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
