export interface PricingInput {
  name: string;
  baseCost: number;
  markup: number;
  currentPrice: number | null;
  monthlyUnits: number;
  ingredients: { supplyId: string; quantity: number }[];
}
export interface Product extends PricingInput {
  id: string;
  version: string;
  referenceCost: number | null;
  active: boolean;
}
export interface PricingData {
  tax: number;
  products: Product[];
  supplies: {
    id: string;
    name: string;
    unit: string;
    active: boolean;
    price: number | null;
    date: string | null;
  }[];
}
export interface Quote {
  cost: number;
  inputCost: number;
  tax: number;
  taxCost: number;
  suggestedPrice: number;
  profit: number;
  margin: number;
  monthlyRevenue: number;
  revenueDifference: number | null;
  lines: {
    name: string;
    unit: string;
    quantity: number;
    price: number;
    cost: number;
  }[];
}
export async function pricingRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/backend/pricing${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Não foi possível acessar a precificação.");
  return data as T;
}
export const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );
export function decimal(text: string, places = 2): number | null {
  if (
    !new RegExp(
      places === 0 ? "^\\d+$" : `^\\d+(?:[,.]\\d{1,${places}})?$`,
    ).test(text)
  )
    return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}
