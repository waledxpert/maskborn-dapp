type RouteContext = { params: Promise<{ tokenId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext) {
  const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
  if (!backendUrl) return Response.json({ error: "Agent service is not configured." }, { status: 503 });
  const { tokenId: rawTokenId } = await context.params;
  const tokenId = rawTokenId.replace(/\.json$/, "");
  if (!/^\d{1,5}$/.test(tokenId)) return Response.json({ error: "Invalid token ID." }, { status: 400 });
  const upstream = await fetch(`${backendUrl}/api/agents/public/tokens/${tokenId}/card`, { cache: "no-store" });
  const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" });
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);
  return new Response(upstream.body, { status: upstream.status, headers });
}
