export interface AccountSettings {
  fullName: string;
  phone: string;
  email: string;
  pendingEmail: string | null;
  cnpj: string;
  emailAlerts: boolean;
  invoiceReminders: boolean;
  lowStockAlerts: boolean;
  timeZone: string;
}
export async function settingsRequest<T>(
  path = "",
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/backend/settings${path}`, {
      method: body === undefined ? "GET" : method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(50000),
    });
  } catch {
    throw new Error(
      "Não foi possível confirmar a solicitação. Verifique sua conexão e atualize os dados antes de tentar novamente.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(
      data?.message || "Não foi possível concluir a solicitação.",
    );
  return data;
}
export function phoneMask(value: string) {
  const n = value.replace(/\D/g, "").slice(0, 11);
  if (n.length <= 2) return n;
  if (n.length <= 6) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
  const split = n.length > 10 ? 7 : 6;
  return `(${n.slice(0, 2)}) ${n.slice(2, split)}${n.length > split ? `-${n.slice(split)}` : ""}`;
}
