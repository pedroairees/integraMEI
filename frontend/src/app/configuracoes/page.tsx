import type { Metadata } from "next";
import { ScreenPage } from "@/src/components/workspace/ScreenPage";
import { SettingsView } from "@/src/components/workspace/SettingsView";

export const metadata: Metadata = { title: "IntegraMEI | Configurações" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ScreenPage
      path="/configuracoes"
      title="Configurações"
      description="Configurações da sua conta."
    >
      <SettingsView />
    </ScreenPage>
  );
}
