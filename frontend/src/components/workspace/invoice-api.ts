export interface InvoiceData {
  supplier: string | null;
  cnpj: string | null;
  recipientCnpj: string | null;
  operation: "sale" | "service" | "other" | null;
  number: string | null;
  date: string | null;
  total: number | null;
  items: string[];
}
export interface SavedInvoice {
  id: string;
  natureza: "revenue" | "cost";
  nome_arquivo: string;
  mime_arquivo: string;
  criado_em: string;
  revisado_em: string | null;
  versao_arquivo: string;
  dados_extracao: InvoiceData;
  exclusao_solicitada_em?: string | null;
  exclusao_justificativa?: string | null;
  lancado_financeiro_em?: string | null;
  status?: string;
  tipo?: "professional" | "personal" | "unclassified";
}
export async function invoiceRequest<T>(
  path = "",
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/backend/invoices${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.message || "Não foi possível acessar suas notas. Tente novamente.",
    );
  return data as T;
}
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(new Error("Não foi possível ler o arquivo selecionado."));
    reader.readAsDataURL(file);
  });
}
