"use client";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { settingsRequest } from "./settings-api";
import styles from "./Screens.module.css";
import css from "./Settings.module.css";

export function SettingsSecurity({
  email,
  pendingEmail,
}: {
  email: string;
  pendingEmail: string | null;
}) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState<"email" | "password" | null>(null);
  const [result, setResult] = useState<{
    area: string;
    message: string;
    error: boolean;
  } | null>(null);
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  async function submit(
    event: FormEvent<HTMLFormElement>,
    area: "email" | "password",
  ) {
    event.preventDefault();
    if (busy) return;
    setResult(null);
    setBusy(area);
    try {
      const data = await settingsRequest<{ message: string }>(
        area === "email" ? "/email" : "/password-reset",
        area === "email"
          ? { email: newEmail.trim() }
          : { currentPassword: password },
      );
      setResult({ area, message: data.message, error: false });
      if (area === "email") setEmailSubmitted(true);
    } catch (error) {
      setResult({
        area,
        message:
          error instanceof Error ? error.message : "Não foi possível concluir.",
        error: true,
      });
    } finally {
      setBusy(null);
      setPassword("");
    }
  }
  const feedback = (area: string) =>
    result?.area === area && (
      <p
        className={`${css.feedback} ${result.error ? css.error : ""}`}
        role={result.error ? "alert" : "status"}
      >
        {result.message}
      </p>
    );
  return (
    <>
      <form
        className={`${styles.card} ${styles.settingsCard} ${styles.passwordCard}`}
        onSubmit={(e) => void submit(e, "password")}
      >
        <h2 className={css.title}>Alterar senha</h2>
        <label className={styles.field} htmlFor="settings-password">
          Senha atual
        </label>
        <div className={styles.passwordBox}>
          <input
            id="settings-password"
            className={styles.input}
            required
            type={visible ? "text" : "password"}
            value={password}
            autoComplete="current-password"
            maxLength={1024}
            disabled={!!busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <p>
          Confirme sua senha atual. Enviaremos um link para definir uma nova
          senha em <strong>{email}</strong>.
        </p>
        <button type="submit" className={styles.primary} disabled={!!busy}>
          {busy === "password" ? "Enviando…" : "Enviar link"}
        </button>
        {feedback("password")}
      </form>
      <form
        className={`${styles.card} ${styles.settingsCard}`}
        onSubmit={(e) => void submit(e, "email")}
      >
        <h2 className={css.title}>Alterar e-mail</h2>
        <p className={css.note}>
          O endereço atual permanece válido até a confirmação da alteração.
        </p>
        {pendingEmail && (
          <p className={css.note}>
            Confirmação pendente para <strong>{pendingEmail}</strong>.
          </p>
        )}
        <label className={styles.field}>
          Novo e-mail
          <input
            type="email"
            className={styles.input}
            required
            maxLength={254}
            autoComplete="email"
            value={newEmail}
            disabled={!!busy}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setEmailSubmitted(false);
            }}
          />
        </label>
        <button
          type="submit"
          className={styles.primary}
          disabled={
            !!busy ||
            emailSubmitted ||
            newEmail.trim().toLowerCase() === email.toLowerCase()
          }
        >
          {busy === "email" ? "Solicitando…" : "Solicitar alteração"}
        </button>
        {feedback("email")}
      </form>
    </>
  );
}
