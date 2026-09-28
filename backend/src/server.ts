import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./web/app.ts";
import { createSessionResolver } from "./infra/supabase/session.ts";

// Transition convenience only: production must configure its own backend environment.
if (
  process.env.NODE_ENV !== "production" &&
  !process.env.SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL
) {
  const previous = resolve(process.cwd(), "../frontend/.env.local");
  if (existsSync(previous)) process.loadEnvFile(previous);
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error(
    "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no backend/.env.",
  );
const app = await buildApp(createSessionResolver(url, key), {
  logger: true,
  docs: process.env.NODE_ENV !== "production",
});
await app.listen({
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? "127.0.0.1",
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });
