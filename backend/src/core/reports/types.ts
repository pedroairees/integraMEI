export type ReportType = "revenue" | "cost" | "profit" | "full";
export type ReportFormat = "pdf" | "xlsx" | "both";
export interface ReportInput {
  start: string;
  end: string;
  type: ReportType;
  scope: "professional" | "all";
  format: ReportFormat;
  originals: boolean;
}
export interface Original {
  id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
}
export interface ReportRow {
  id: string;
  date: string;
  amount: number;
  kind: "revenue" | "cost";
  scope: string;
  label: string;
  category: string;
  file: Original | null;
  invoice: boolean;
}
export interface ReportSource {
  company: { name: string; cnpj: string; timeZone?: string };
  rows: ReportRow[];
}
export interface Report extends ReportSource {
  input: ReportInput;
  generatedAt: string;
  totals: {
    revenue: number;
    cost: number;
    personal: number;
    unclassified: number;
    profit: number;
  };
}
export interface ReportRepository {
  source(start: string, end: string): Promise<ReportSource>;
  original(file: Original): Promise<Buffer>;
  reserve(id: string, hash: string): Promise<string>;
  finish(id: string, status: "sent" | "uncertain"): Promise<void>;
}
export interface ReportFile {
  name: string;
  mime: string;
  content: Buffer;
}
export interface ReportMailer {
  configured: boolean;
  send(to: string, files: ReportFile[], id: string): Promise<void>;
}
