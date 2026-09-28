import type { CookieOptions } from "@supabase/ssr";

export const REMEMBER_COOKIE = "integramei-remember";

// The dashboard uses server-only cookies; the existing invitation flow stays independent.
export function sessionCookieOptions(options: CookieOptions, remember: boolean): CookieOptions {
  const result: CookieOptions = {
    ...options,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  };

  if (options.maxAge === 0) return result;

  delete result.expires;
  if (remember) result.maxAge = 60 * 60 * 24 * 30;
  else delete result.maxAge;

  return result;
}
