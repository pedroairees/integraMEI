"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./Screens.module.css";
import css from "./Reports.module.css";
export function ReportsView() {
  const [initial, setInitial] = useState(""),
    [final, setFinal] = useState("");
  const [type, setType] = useState("full"),
    [scope, setScope] = useState("professional");
  const [format, setFormat] = useState("pdf"),
    [delivery, setDelivery] = useState("download");
  const [originals, setOriginals] = useState(false),
    [recipient, setRecipient] = useState(""),
    [consent, setConsent] = useState(false);
  const [emailReady, setEmailReady] = useState<boolean | "unavailable" | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/backend/reports/options", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => setEmailReady(d.emailConfigured === true))
      .catch(() => {
        if (!controller.signal.aborted) setEmailReady("unavailable");
      });
    return () => controller.abort();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage("");
    setError(false);
    if (
      initial > final ||
      (Date.parse(final) - Date.parse(initial)) / 86400000 > 366
    ) {
      setMessage("Selecione um período válido de até 367 dias.");
      setError(true);
      return;
    }
    if (delivery === "email" && (emailReady !== true || !consent || attempted))
      return;
    setBusy(true);
    try {
      const input = {
        start: initial,
        end: final,
        type,
        scope,
        format,
        originals,
      };
      if (delivery === "email") {
        requestId.current ??= crypto.randomUUID();
        setAttempted(true);
      }
      const response = await fetch(`/api/backend/reports/${delivery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          delivery === "email"
            ? {
                ...input,
                recipient: recipient.trim(),
                requestId: requestId.current,
              }
            : input,
        ),
        signal: AbortSignal.timeout(125000),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Não foi possível gerar o relatório.");
      }
      if (delivery === "email") {
        const data = await response.json();
        setMessage(data.message);
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download =
          /filename="([^"]+)"/.exec(
            response.headers.get("content-disposition") || "",
          )?.[1] || "integramei-relatorio";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage("Relatório gerado. Confira o download no navegador.");
      }
    } catch (e) {
      setError(true);
      setMessage(
        e instanceof Error && e.name !== "TimeoutError"
          ? e.message
          : delivery === "email"
            ? "O envio não foi confirmado. Confira a caixa de entrada e o spam antes de iniciar outro envio."
            : "A geração demorou além do limite. Reduza o período e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.reports} onSubmit={submit}>
      <fieldset disabled={busy} className={css.fields}>
        <h2>Período</h2>
        <div className={`${styles.card} ${styles.dateFields}`}>
          <label className={styles.field}>
            Data Inicial
            <span className={styles.dateBox}>
              <input
                type="date"
                required
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
              />
            </span>
          </label>
          <label className={styles.field}>
            Data Final
            <span className={styles.dateBox}>
              <input
                type="date"
                required
                min={initial || undefined}
                value={final}
                onChange={(e) => setFinal(e.target.value)}
              />
            </span>
          </label>
        </div>
        <fieldset className={`${styles.card} ${styles.optionsCard}`}>
          <legend>Tipo de relatório</legend>
          <div className={styles.radioRow}>
            {[
              ["revenue", "Faturamento"],
              ["profit", "Lucro"],
              ["cost", "Custos"],
              ["full", "Relatório completo"],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="report-type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value!)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={css.field}>
          Finalidade
          <select
            className={styles.input}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="professional">Somente profissional</option>
            <option value="all">Todos, com gastos pessoais separados</option>
          </select>
        </label>
        <fieldset className={`${styles.card} ${styles.optionsCard}`}>
          <legend>Formato</legend>
          <div className={styles.radioRow}>
            {[
              ["pdf", "PDF"],
              ["xlsx", "Excel (XLSX)"],
              ["both", "PDF e Excel"],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="report-format"
                  checked={format === value}
                  onChange={() => setFormat(value!)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className={`${styles.card} ${styles.optionsCard}`}>
          <legend>Entrega</legend>
          <div className={styles.radioRow}>
            <label>
              <input
                type="radio"
                name="report-delivery"
                checked={delivery === "download"}
                onChange={() => setDelivery("download")}
              />
              Baixar arquivo
            </label>
            <label>
              <input
                type="radio"
                name="report-delivery"
                checked={delivery === "email"}
                onChange={() => setDelivery("email")}
              />
              Enviar por e-mail
            </label>
          </div>
        </fieldset>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={originals}
            onChange={(e) => setOriginals(e.target.checked)}
          />
          Incluir notas originais (até 30 notas e 10 MB no total)
        </label>
        <p className={css.note}>
          PDF e Excel juntos, ou com notas originais, são baixados em ZIP. No
          e-mail, cada arquivo segue como anexo. O período considera a emissão
          da nota e a data da venda. Somente lançamentos financeiros são
          incluídos; o lucro não desconta gastos pessoais. Exportar não fecha o
          mês.
        </p>
        {delivery === "email" && (
          <>
            <label className={css.field}>
              E-mail do destinatário
              <input
                type="email"
                className={styles.input}
                required
                maxLength={254}
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  setConsent(false);
                }}
                placeholder="contador@exemplo.com"
              />
            </label>
            <label className={css.check}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              Conferi o destinatário e autorizo compartilhar os dados
              financeiros e os anexos selecionados.
            </label>
            {emailReady !== true && (
              <p className={css.message} role="status">
                {emailReady === null
                  ? "Verificando configuração de e-mail…"
                  : emailReady === "unavailable"
                    ? "Não foi possível verificar a disponibilidade do e-mail. Atualize a página para tentar novamente."
                    : "O envio por e-mail ainda não foi configurado. Você pode selecionar Baixar arquivo e enviar os documentos pelo seu e-mail."}
              </p>
            )}
          </>
        )}
        <button
          type="submit"
          className={styles.primary}
          disabled={
            delivery === "email" &&
            (emailReady !== true || !consent || attempted)
          }
        >
          {busy
            ? "Processando…"
            : delivery === "email"
              ? "Enviar relatório"
              : "Gerar Relatório"}
        </button>
        {delivery === "email" && attempted && (
          <div>
            <button
              type="button"
              className={css.retry}
              onClick={() => {
                if (
                  window.confirm(
                    "Confira primeiro se o destinatário já recebeu o relatório. Deseja iniciar um novo envio?",
                  )
                ) {
                  requestId.current = null;
                  setAttempted(false);
                  setConsent(false);
                  setMessage("");
                }
              }}
            >
              Iniciar novo envio
            </button>
          </div>
        )}
      </fieldset>
      {message && (
        <p
          role={error ? "alert" : "status"}
          className={`${css.message} ${error ? css.error : ""}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
