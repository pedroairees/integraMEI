import { createClient } from "@supabase/supabase-js";
import { AppError } from "../../core/errors.ts";
import type {
  DashboardRepository,
  Tenant,
} from "../../core/dashboard/types.ts";
import { SupabaseDashboardRepository } from "./repository.ts";
import { SupabaseInvoiceRepository } from "./invoices.ts";
import type { InvoiceRepository } from "../../core/invoices/types.ts";
import type { SuppliesRepository } from "../../core/supplies/types.ts";
import { SupabaseSuppliesRepository } from "./supplies.ts";
import { SupabasePricingRepository } from "./pricing.ts";
import { SupabaseReportRepository } from "./reports.ts";
import type { ReportRepository } from "../../core/reports/types.ts";
import type { PricingRepository } from "../../core/pricing/types.ts";
import type { SettingsRepository } from "../../core/settings/types.ts";
import { SupabaseSettingsRepository } from "./settings.ts";

export interface SessionContext {
  tenant: Tenant;
  repository: DashboardRepository;
  invoices?: InvoiceRepository;
  supplies?: SuppliesRepository;
  pricing?: PricingRepository;
  reports?: ReportRepository;
  settings?: SettingsRepository;
}
export type ResolveSession = (token: string) => Promise<SessionContext>;
export function createSessionResolver(
  url: string,
  publicKey: string,
): ResolveSession {
  return async (token) => {
    const client = createClient(url, publicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
      },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user?.email_confirmed_at)
      throw new AppError(401, "Sua sessão expirou. Entre novamente.");
    const profile = await client
      .from("usuarios")
      .select("id")
      .eq("usuario_auth_id", data.user.id)
      .maybeSingle();
    if (profile.error)
      throw new AppError(502, "Não foi possível verificar o perfil.");
    if (!profile.data)
      throw new AppError(403, "Seu cadastro não possui um perfil vinculado.");
    const membership = await client
      .from("membros_empresa")
      .select("empresa_id,papel")
      .eq("usuario_id", profile.data.id)
      .maybeSingle();
    if (membership.error || !membership.data)
      throw new AppError(
        403,
        "Não foi possível identificar uma única empresa vinculada à sua conta.",
      );
    return {
      tenant: {
        companyId: membership.data.empresa_id,
        profileId: profile.data.id,
        role: membership.data.papel,
      },
      repository: new SupabaseDashboardRepository(client),
      settings: new SupabaseSettingsRepository(client, membership.data.empresa_id, data.user, url, publicKey, token),
      reports: new SupabaseReportRepository(client,membership.data.empresa_id),
      pricing: new SupabasePricingRepository(client, membership.data.empresa_id),
      supplies: new SupabaseSuppliesRepository(client, membership.data.empresa_id, data.user.id),
      invoices: new SupabaseInvoiceRepository(
        client,
        data.user.id,
        membership.data.empresa_id,
      ),
    };
  };
}
