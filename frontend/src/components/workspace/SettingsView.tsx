"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  settingsRequest,
  phoneMask,
  type AccountSettings,
} from "./settings-api";
import { SettingsSecurity } from "./SettingsSecurity";
import styles from "./Screens.module.css";
import css from "./Settings.module.css";
const preferences = [
  ["emailAlerts", "Receber alertas por e-mail"],
  ["invoiceReminders", "Lembretes notas fiscais"],
  ["lowStockAlerts", "Alertas de estoque baixo"],
] as const;

export function SettingsView() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountSettings | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    settingsRequest<AccountSettings>("", undefined, "GET", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setAccount(data);
          setMessage("");
          setError(false);
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) {
          setMessage(err.message);
          setError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || busy) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const {
        fullName,
        phone,
        emailAlerts,
        invoiceReminders,
        lowStockAlerts,
        timeZone,
      } = account;
      const saved = await settingsRequest<AccountSettings>(
        "",
        {
          fullName: fullName.trim(),
          phone: phone.replace(/\D/g, ""),
          emailAlerts,
          invoiceReminders,
          lowStockAlerts,
          timeZone,
        },
        "PATCH",
      );
      setAccount(saved);
      setMessage("Configurações salvas na sua conta.");
      router.refresh();
    } catch (err) {
      setError(true);
      setMessage(
        err instanceof Error ? err.message : "Não foi possível salvar.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return <p role="status">Carregando configurações da sua conta…</p>;
  if (!account)
    return (
      <div>
        <p role="alert" className={css.error}>
          {message}
        </p>
        <button
          type="button"
          className={css.secondary}
          onClick={() => {
            setLoading(true);
            setReload((n) => n + 1);
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  const change = <K extends keyof AccountSettings>(
    key: K,
    value: AccountSettings[K],
  ) => setAccount({ ...account, [key]: value });
  const cnpj = account.cnpj
    .replace(/\D/g, "")
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return (
    <section aria-label="Configurações da conta">
      <p className={styles.cnpj}>
        <strong>CNPJ:</strong> {cnpj}
      </p>
      <div className={styles.settingsGrid}>
        <form
          id="settings-profile"
          className={`${styles.card} ${styles.settingsCard}`}
          onSubmit={(e) => void save(e)}
        >
          <h2 className={css.title}>Dados pessoais</h2>
          <label className={styles.field}>
            Nome completo
            <input
              className={styles.input}
              required
              minLength={2}
              maxLength={160}
              autoComplete="name"
              disabled={busy}
              value={account.fullName}
              onChange={(e) => change("fullName", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            E-mail atual
            <input
              className={styles.input}
              type="email"
              readOnly
              value={account.email}
            />
          </label>
          <label className={styles.field}>
            Telefone
            <input
              className={styles.input}
              type="tel"
              required
              autoComplete="tel-national"
              inputMode="tel"
              maxLength={15}
              disabled={busy}
              value={phoneMask(account.phone)}
              onChange={(e) =>
                change("phone", e.target.value.replace(/\D/g, "").slice(0, 11))
              }
            />
          </label>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Salvando…" : "Salvar configurações"}
          </button>
          {message && (
            <p
              role={error ? "alert" : "status"}
              className={`${css.feedback} ${error ? css.error : ""}`}
            >
              {message}
            </p>
          )}
        </form>
        <section
          className={`${styles.card} ${styles.settingsCard} ${styles.preferences}`}
          aria-label="Preferências de notificações"
        >
          {preferences.map(([key, label]) => (
            <div className={styles.toggleRow} key={key}>
              <span id={`preference-${key}`}>{label}</span>
              <button
                type="button"
                className={styles.switch}
                role="switch"
                disabled={busy}
                aria-checked={account[key]}
                aria-labelledby={`preference-${key}`}
                onClick={() => change(key, !account[key])}
              />
            </div>
          ))}
          <p className={css.note}>
            As preferências são gravadas ao salvar as configurações. O envio
            automático de alertas e lembretes ainda não está disponível.
          </p>
        </section>
        <SettingsSecurity
          email={account.email}
          pendingEmail={account.pendingEmail}
        />
        <section
          className={`${styles.card} ${styles.settingsCard}`}
          aria-label="Preferências regionais"
        >
          <label className={styles.field}>
            Idioma
            <select className={styles.select} value="pt-BR" disabled>
              <option value="pt-BR">Português</option>
            </select>
          </label>
          <label className={styles.field}>
            Moeda Padrão
            <select className={styles.select} value="BRL" disabled>
              <option value="BRL">R$ - Real (BRL)</option>
            </select>
          </label>
          <p className={css.note}>
            O sistema trabalha em português e valores em reais.
          </p>
          <label className={styles.field}>
            Fuso horário dos relatórios
            <select
              className={styles.select}
              disabled={busy}
              value={account.timeZone}
              onChange={(e) => change("timeZone", e.target.value)}
            >
              <option value="America/Sao_Paulo">(GMT-03:00) Brasília</option>
              <option value="America/Manaus">(GMT-04:00) Manaus</option>
              <option value="America/Rio_Branco">(GMT-05:00) Rio Branco</option>
            </select>
          </label>
          <button
            type="submit"
            form="settings-profile"
            className={css.secondary}
            disabled={busy}
          >
            Salvar preferências
          </button>
        </section>
        <section className={`${styles.card} ${styles.about}`}>
          <h2>Sobre o IntegraMEI</h2>
          <p>Versão 1.0.0 - Plataforma de gestão para MEIs.</p>
        </section>
      </div>
    </section>
  );
}
