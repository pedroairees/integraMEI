import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionSupabaseClient } from "@/src/lib/supabase/session";
import { DashboardView } from "@/src/components/dashboard/DashboardView";

export const metadata: Metadata = { title: "IntegraMEI | Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await getSessionSupabaseClient({ readOnly: true });
  // Revalidate identity here too: protecting only a layout/proxy is insufficient.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email_confirmed_at) redirect("/");

  const fullName: unknown = user.user_metadata?.nome_completo;
  const firstName = typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] : "";

  return <DashboardView firstName={firstName || "Usuário"} />;
}
