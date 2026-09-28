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
      description="Históricos de valores atualizados com base no mercado. Selecionamos os produtos com base no seu perfil, escolha dentre as opções abaixo."
    >
      <SuppliesView />
    </ScreenPage>
  );
}
