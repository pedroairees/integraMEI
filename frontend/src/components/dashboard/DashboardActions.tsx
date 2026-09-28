"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./Dashboard.module.css";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok)
        throw new Error("Não foi possível sair. Tente novamente.");
      // Full navigation discards the authenticated page from the client router cache.
      window.location.replace("/");
    } catch {
      setError("Não foi possível sair. Tente novamente.");
      setPending(false);
    }
  }

  return (
    <div className={styles.logoutArea}>
      <button
        className={styles.logout}
        onClick={logout}
        disabled={pending}
        type="button"
      >
        <Image
          src="/assets/dashboard/logout.svg"
          alt=""
          width={18}
          height={14}
        />
        {pending ? "Saindo..." : "Finalizar sessão"}
      </button>
      {error && (
        <p role="alert" className={styles.logoutError}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Notifications({
  alerts,
}: {
  alerts: { id: string; mensagem: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.notifications}>
      <button
        type="button"
        aria-label="Notificações"
        aria-expanded={open}
        aria-controls="dashboard-notifications"
        onClick={() => setOpen(!open)}
        className={styles.notificationButton}
      >
        <Image
          src="/assets/dashboard/notification.svg"
          alt=""
          width={28}
          height={34}
        />
      </button>
      {open && (
        <div
          id="dashboard-notifications"
          role="status"
          className={styles.notificationPanel}
        >
          {alerts.length ? (
            <ul>
              {alerts.map((alert) => (
                <li key={alert.id}>{alert.mensagem}</li>
              ))}
            </ul>
          ) : (
            "Nenhum alerta para sua empresa."
          )}
        </div>
      )}
    </div>
  );
}
