type RouteContext = { params: Promise<{ tokenId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext) {
  const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
  if (!backendUrl) {
    return Response.json({ error: "Agent registry unavailable" }, { status: 503 });
  }

  const { tokenId } = await context.params;
  if (!/^\d{1,5}$/.test(tokenId)) {
    return Response.json({ error: "Invalid token ID" }, { status: 400 });
  }

  const upstream = await fetch(
    `${backendUrl}/api/agents/public/tokens/${encodeURIComponent(tokenId)}/registration`,
    { cache: "no-store" },
  );
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/json");
  headers.set("cache-control", upstream.headers.get("cache-control") ?? "public, max-age=30");
  return new Response(upstream.body, { status: upstream.status, headers });
}
