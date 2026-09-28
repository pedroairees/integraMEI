import Image from "next/image";
import Link from "next/link";
import { LogoutButton } from "../dashboard/DashboardActions";
import styles from "../dashboard/Dashboard.module.css";

export const sections = [
  { path: "/dashboard", label: "Dashboard", icon: "home" },
  { path: "/notas-fiscais", label: "Notas Fiscais", icon: "notes" },
  { path: "/insumos", label: "Insumos", icon: "supplies" },
  { path: "/precificacao", label: "Precificação", icon: "pricing" },
  { path: "/alertas", label: "Alertas", icon: "alarm" },
  { path: "/relatorios", label: "Relatórios", icon: "reports" },
  { path: "/configuracoes", label: "Configurações", icon: "settings" },
] as const;

export function WorkspaceSidebar({ activePath }: { activePath: string }) {
  return (
    <aside className={styles.sidebar} aria-label="Menu principal">
      <Link
        href="/dashboard"
        className={styles.brand}
        aria-label="IntegraMEI — Dashboard"
      >
        <span className={styles.logoCrop}>
          <Image
            src="/assets/integramei-logo.png"
            alt=""
            width={489}
            height={343}
            className={styles.logo}
            priority
          />
        </span>
        <span className={styles.brandName}>
          Integ<span>ra</span>
          <strong>MEI</strong>
        </span>
      </Link>
      <nav className={styles.navigation} aria-label="Seções do IntegraMEI">
        {sections.map(({ path, label, icon }) => {
          const active = path === activePath;
          const asset =
            icon === "home"
              ? active
                ? "/assets/dashboard/home.svg"
                : "/assets/screens/home.svg"
              : active
                ? `/assets/screens/${icon}-active.svg`
                : `/assets/dashboard/${icon}.svg`;
          return (
            <Link
              key={path}
              href={path}
              aria-current={active ? "page" : undefined}
              className={active ? styles.activeItem : styles.navItem}
            >
              <span className={styles.menuIcon}>
                <Image
                  src={asset}
                  alt=""
                  width={icon === "settings" ? 32 : icon === "home" ? 24 : 20}
                  height={icon === "settings" ? 26 : icon === "home" ? 24 : 20}
                />
                {icon === "alarm" && (
                  <Image
                    className={styles.alarmInner}
                    src={
                      active
                        ? "/assets/screens/alarm-inner-active.svg"
                        : "/assets/dashboard/alarm-inner.svg"
                    }
                    alt=""
                    width={9}
                    height={13}
                  />
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </nav>
      <LogoutButton />
    </aside>
  );
}
