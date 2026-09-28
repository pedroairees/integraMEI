import type { Metadata } from "next";
import { ScreenPage } from "@/src/components/workspace/ScreenPage";
import { AlertsView } from "@/src/components/workspace/AlertsView";

export const metadata: Metadata = { title: "IntegraMEI | Alertas" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ScreenPage
      path="/alertas"
      title="Alertas"
      description="Atualizações, tendências e oportunidades do mercado atual."
    >
      <AlertsView />
    </ScreenPage>
  );
}
