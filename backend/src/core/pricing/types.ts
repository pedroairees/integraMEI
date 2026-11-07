export interface PricingInput {
  name: string;
  baseCost: number;
  markup: number;
  currentPrice: number | null;
  monthlyUnits: number;
  ingredients: { supplyId: string; quantity: number }[];
}
export interface PricingRepository {
  data(): Promise<unknown>;
  quote(input: PricingInput): Promise<unknown>;
  save(
    id: string,
    version: string | null,
    input: PricingInput,
  ): Promise<unknown>;
}
