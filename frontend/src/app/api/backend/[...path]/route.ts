import { getSessionSupabaseClient } from "@/src/lib/supabase/session";

// Transport adapter only. Financial rules and database queries live in backend/.
async function limitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
async function forward(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const allowed =
      (request.method === "GET" &&
        (route === "dashboard" ||
          route === "invoices" ||
          /^invoices\/[0-9a-f-]{36}\/file$/i.test(route) ||
          /^supplies\/[0-9a-f-]{36}\/history$/i.test(route))) ||
      (request.method === "DELETE" &&
        /^invoices\/[0-9a-f-]{36}$/i.test(route)) ||
      (request.method === "PATCH" &&
        (route === "dashboard/goal" ||
          /^invoices\/[0-9a-f-]{36}$/i.test(route))) ||
      (request.method === "POST" &&
        (route === "invoices" ||
          /^invoices\/[0-9a-f-]{36}\/(read|post)$/i.test(route)));
    if (!allowed)
      return Response.json(
        { message: "Rota não encontrada." },
        { status: 404, headers },
      );
    if (
      request.method !== "GET" &&
      request.headers.get("origin") !== new URL(request.url).origin
    )
      return Response.json(
        { message: "Origem inválida." },
        { status: 403, headers },
      );
    const client = await getSessionSupabaseClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user?.email_confirmed_at)
      return Response.json(
        { message: "Sua sessão expirou. Entre novamente." },
        { status: 401, headers },
      );
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session)
      return Response.json(
        { message: "Entre novamente." },
        { status: 401, headers },
      );
    const base =
      process.env.BACKEND_URL ??
      (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3333" : "");
    if (!base) throw new Error("Backend not configured");
    const limit =
      route === "invoices"
        ? 7 * 1024 * 1024
        : route.startsWith("invoices/")
          ? 128 * 1024
          : 8192;
    const body =
      request.method !== "GET" ? await limitedBody(request, limit) : undefined;
    if (body === null)
      return Response.json(
        { message: "Solicitação muito grande." },
        { status: 413, headers },
      );
    const response = await fetch(
      `${base.replace(/\/$/, "")}/v1/${route}${new URL(request.url).search}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body || undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(
          route.startsWith("invoices") ? 60000 : 20000,
        ),
        redirect: "error",
      },
    );
    if (route.endsWith("/file") && response.ok) {
      return new Response(response.body, {
        status: response.status,
        headers: {
          ...headers,
          "Content-Type":
            response.headers.get("Content-Type") || "application/octet-stream",
          "Content-Disposition":
            response.headers.get("Content-Disposition") || "attachment",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return new Response(
      response.status === 204 ? null : await response.text(),
      {
        status: response.status,
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
  } catch {
    return Response.json(
      {
        message:
          "Não foi possível acessar o backend. Confira se ele está em execução e tente novamente.",
      },
      { status: 503, headers },
    );
  }
}
export const GET = forward;
export const PATCH = forward;
export const POST = forward;
export const DELETE = forward;
