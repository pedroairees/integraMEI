import type { Metadata } from "next";
import { ScreenPage } from "@/src/components/workspace/ScreenPage";
import { InvoicesView } from "@/src/components/workspace/InvoicesView";

export const metadata: Metadata = { title: "IntegraMEI | Notas Fiscais" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ScreenPage
      path="/notas-fiscais"
      title="Notas Fiscais"
      description="Anexo e consultas de Notas Fiscais."
      preview={false}
    >
      <InvoicesView />
    </ScreenPage>
  );
}
