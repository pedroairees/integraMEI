import type { Metadata } from "next";
import { ScreenPage } from "@/src/components/workspace/ScreenPage";
import { ReportsView } from "@/src/components/workspace/ReportsView";

export const metadata: Metadata = { title: "IntegraMEI | Relatórios" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ScreenPage
      path="/relatorios"
      title="Relatórios"
      description="Relatórios atualizados com base em dados selecionados e no prazo a definir."
    >
      <ReportsView />
    </ScreenPage>
  );
}
