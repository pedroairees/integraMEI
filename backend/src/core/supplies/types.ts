export interface SupplyRecord {
  id: string;
  nome: string;
  unidade_medida: string;
  estoque_minimo: number;
  ativo: boolean;
  versao_cadastro: string;
}
export interface SupplyInput {
  name: string;
  unit: string;
  minimum: number;
  active: boolean;
  version?: string;
}
export interface PriceInput {
  requestId: string;
  source: "manual" | "invoice";
  invoiceId?: string;
  itemIndex?: number;
  date?: string;
  quantity: number;
  price: number;
  supplier?: string;
}
export interface PricePoint {
  id: string;
  date: string;
  value: number;
  unit: string;
  supplier: string;
  source: "manual" | "invoice";
}
export interface SupplyInvoice {
  id: string;
  nome_arquivo: string;
  data_emissao: string;
  valor_total: number;
  dados_extracao: { supplier: string; items: string[] };
}
export interface SuppliesRepository {
  list(query: string, offset: number): Promise<SupplyRecord[]>;
  get(id: string): Promise<SupplyRecord>;
  save(id: string | null, input: SupplyInput): Promise<SupplyRecord>;
  prices(id: string, start: string, end: string): Promise<PricePoint[]>;
  register(id: string, input: PriceInput): Promise<void>;
  invoices(): Promise<SupplyInvoice[]>;
}
