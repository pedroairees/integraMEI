import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionSupabaseClient } from "@/src/lib/supabase/session";
import { REMEMBER_COOKIE } from "@/src/lib/supabase/session-options";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ message: "Origem da solicitação inválida." }, { status: 403 });
  }

  try {
    const supabase = await getSessionSupabaseClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      return NextResponse.json({ message: "Não foi possível encerrar a sessão. Tente novamente." }, { status: 503 });
    }
    (await cookies()).delete(REMEMBER_COOKIE);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Não foi possível encerrar a sessão. Tente novamente." }, { status: 503 });
  }
}
