import { WorkspaceSidebar } from "../workspace/WorkspaceSidebar";
import { DashboardPanel } from "./DashboardPanel";
import styles from "./Dashboard.module.css";

export function DashboardView({ firstName }: { firstName: string }) {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#dashboard-content">
        Ir para o conteúdo
      </a>
      <div className={styles.shell}>
        <WorkspaceSidebar activePath="/dashboard" />
        <main id="dashboard-content" className={styles.content}>
          <header className={styles.header}>
            <div className={styles.greeting}>
              <h1>Olá, {firstName}!</h1>
            </div>
            <p>
              Aqui está o resumo do seu negócio, com vendas e despesas
              confirmadas.
            </p>
          </header>
          <DashboardPanel />
        </main>
      </div>
    </div>
  );
}
