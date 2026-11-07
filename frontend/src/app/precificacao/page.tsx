import type { Metadata } from "next";
import { ScreenPage } from "@/src/components/workspace/ScreenPage";
import { PricingView } from "@/src/components/workspace/PricingView";

export const metadata: Metadata = { title: "IntegraMEI | Precificação" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ScreenPage
      path="/precificacao"
      title="Precificação"
      description="Calcule e salve preços com base nos custos da sua empresa, nos insumos e no markup desejado."
    >
      <PricingView />
    </ScreenPage>
  );
}
