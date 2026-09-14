import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";

const INVALID_CREDENTIALS = "CNPJ ou senha inválidos.";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cnpj?: unknown; password?: unknown };
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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
      throw new Error("As credenciais públicas do Supabase não estão configuradas.");
    }

    const authClient = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (error || !data.session) {
      return NextResponse.json({ message: INVALID_CREDENTIALS }, { status: 401 });
    }

    return NextResponse.json(
      { session: data.session },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "Não foi possível entrar agora. Tente novamente." },
      { status: 500 },
    );
  }
}
