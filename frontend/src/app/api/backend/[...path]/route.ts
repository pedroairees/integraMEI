import { getSessionSupabaseClient } from "@/src/lib/supabase/session";

// Transport adapter only. Financial rules and database queries live in backend/.
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
          /^supplies\/[0-9a-f-]{36}\/history$/i.test(route))) ||
      (request.method === "PATCH" && route === "dashboard/goal");
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
    const body = request.method === "PATCH" ? await request.text() : undefined;
    if (body && body.length > 8192)
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
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
    );
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
