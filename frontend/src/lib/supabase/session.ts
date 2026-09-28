import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { REMEMBER_COOKIE, sessionCookieOptions } from "./session-options";

export async function getSessionSupabaseClient(options: { readOnly?: boolean; remember?: boolean } = {}) {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) throw new Error("Configuração pública do Supabase ausente.");

  const remember = options.remember ?? cookieStore.get(REMEMBER_COOKIE)?.value === "true";

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        // Proxy refreshes tokens before Server Components render.
        if (options.readOnly) return;
        for (const { name, value, options: cookieOptions } of cookiesToSet) {
          cookieStore.set(name, value, sessionCookieOptions(cookieOptions, remember));
        }
      },
    },
  });
}
