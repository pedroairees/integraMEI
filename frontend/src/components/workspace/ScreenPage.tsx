import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionSupabaseClient } from "@/src/lib/supabase/session";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import shell from "../dashboard/Dashboard.module.css";
import styles from "./Screens.module.css";

export async function ScreenPage({
  path,
  title,
  description,
  children,
  preview = true,
}: {
  path: string;
  title: string;
  description: string;
  children: ReactNode;
  preview?: boolean;
}) {
  const supabase = await getSessionSupabaseClient({ readOnly: true });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email_confirmed_at) redirect("/");

  return (
    <div className={shell.page}>
      <a className={shell.skipLink} href="#screen-content">
        Ir para o conteúdo
      </a>
      <div className={shell.shell}>
        <WorkspaceSidebar activePath={path} />
        <main id="screen-content" className={styles.content}>
          <header className={styles.header}>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </main>
      </div>
      {preview && (
        <p className={styles.demoNotice}>
          Prévia das telas • Dados demonstrativos do Figma. Alterações e
          arquivos ficam apenas nesta tela; nada é enviado ou salvo.
        </p>
      )}
    </div>
  );
}
