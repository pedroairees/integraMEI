import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getServerSupabaseClient } from "@/src/lib/supabase/server";
import { getSessionSupabaseClient } from "@/src/lib/supabase/session";
import { REMEMBER_COOKIE, sessionCookieOptions } from "@/src/lib/supabase/session-options";

export const runtime = "nodejs";

const INVALID_CREDENTIALS = "CNPJ ou senha inválidos.";

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      return NextResponse.json({ message: "Origem da solicitação inválida." }, { status: 403 });
    }

    const body = (await request.json()) as { cnpj?: unknown; password?: unknown; rememberMe?: unknown };
    const cnpj = typeof body.cnpj === "string" ? body.cnpj.replace(/\D/g, "") : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (cnpj.length !== 14 || !password) {
      return NextResponse.json({ message: INVALID_CREDENTIALS }, { status: 400 });
    }

    const admin = getServerSupabaseClient();
    const { data: company } = await admin
      .from("empresas")
      .select("id")
      .eq("cnpj", cnpj)
      .maybeSingle();

    if (!company) {
      return NextResponse.json({ message: INVALID_CREDENTIALS }, { status: 401 });
    }

    const { data: membership } = await admin
      .from("membros_empresa")
      .select("usuario_id")
      .eq("empresa_id", company.id)
      .eq("papel", "owner")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ message: INVALID_CREDENTIALS }, { status: 401 });
    }

    const { data: user } = await admin
      .from("usuarios")
      .select("email")
      .eq("id", membership.usuario_id)
      .maybeSingle();

    if (!user?.email) {
      return NextResponse.json({ message: INVALID_CREDENTIALS }, { status: 401 });
    }

    const remember = body.rememberMe === true;
    const authClient = await getSessionSupabaseClient({ remember });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (error || !data.session || !data.user.email_confirmed_at) {
      return NextResponse.json({ message: INVALID_CREDENTIALS }, { status: 401 });
    }

    (await cookies()).set(REMEMBER_COOKIE, String(remember), sessionCookieOptions({}, remember));

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "Não foi possível entrar agora. Tente novamente." },
      { status: 500 },
    );
  }
}
