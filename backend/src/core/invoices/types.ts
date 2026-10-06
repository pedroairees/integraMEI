export type InvoiceKind = "revenue" | "cost";
export interface ExtractedInvoice {
  supplier: string | null;
  cnpj: string | null;
  recipientCnpj: string | null;
  operation: "sale" | "service" | "other" | null;
  number: string | null;
  date: string | null;
  total: number | null;
  items: string[];
}
export interface Invoice {
  id: string;
  natureza: InvoiceKind;
  nome_arquivo: string;
  mime_arquivo: string;
  tamanho_arquivo: number;
  caminho_arquivo: string;
  hash_arquivo: string;
  criado_em: string;
  status: string;
  revisado_em: string | null;
  versao_arquivo: string;
  dados_extracao: ExtractedInvoice;
  exclusao_solicitada_em?: string | null;
  exclusao_justificativa?: string | null;
  lancado_financeiro_em?: string | null;
  tipo?: "professional" | "personal" | "unclassified";
}
export interface InvoiceFilter {
  kind: InvoiceKind;
  period: "current" | "previous" | "all";
  offset: number;
}
export interface InvoiceRepository {
  companyCnpj(): Promise<string>;
  list(filter: InvoiceFilter): Promise<Invoice[]>;
  get(id: string): Promise<Invoice>;
  duplicate(hash: string): Promise<Invoice | null>;
  upload(path: string, file: Buffer, mime: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  insert(invoice: Invoice): Promise<Invoice>;
  download(invoice: Invoice): Promise<Buffer>;
  save(
    invoice: Invoice,
    data: ExtractedInvoice,
    reviewed: boolean,
  ): Promise<Invoice>;
  filePath(id: string, extension: string): string;
  beginDeletion(invoice: Invoice, reason: string): Promise<Invoice>;
  finishDeletion(invoice: Invoice): Promise<void>;
  post(invoice: Invoice, scope: "professional" | "personal"): Promise<Invoice>;
}
export interface InvoiceReader {
  read(file: Buffer, mime: string): Promise<ExtractedInvoice>;
}
