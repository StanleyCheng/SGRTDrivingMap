import { getTrafficImages } from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getTrafficImages();
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
