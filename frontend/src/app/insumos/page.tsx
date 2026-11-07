import type { Metadata } from "next";
import { ScreenPage } from "@/src/components/workspace/ScreenPage";
import { SuppliesView } from "@/src/components/workspace/SuppliesView";

export const metadata: Metadata = { title: "IntegraMEI | Insumos" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ScreenPage
      path="/insumos"
      title="Insumos"
      description="Acompanhe os preços dos insumos da sua empresa. Compare fornecedores e consulte compras registradas manualmente ou vinculadas às suas notas de custo."
    >
      <SuppliesView />
    </ScreenPage>
  );
}
