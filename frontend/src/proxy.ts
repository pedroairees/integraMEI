import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REMEMBER_COOKIE, sessionCookieOptions } from "./lib/supabase/session-options";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const remember = request.cookies.get(REMEMBER_COOKIE)?.value === "true";
  let authenticated = false;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, sessionCookieOptions(options, remember));
          }
        },
      },
    });

    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      authenticated = !error && !!user && !!user.email_confirmed_at;
    } catch {
      authenticated = false;
    }
  }

  if (!authenticated) {
    const redirect = NextResponse.redirect(new URL("/", request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    response = redirect;
  }

  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = { matcher: ["/dashboard/:path*", "/notas-fiscais/:path*", "/insumos/:path*", "/precificacao/:path*", "/alertas/:path*", "/relatorios/:path*", "/configuracoes/:path*"] };
