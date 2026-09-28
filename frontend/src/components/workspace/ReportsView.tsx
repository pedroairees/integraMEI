"use client";

import { useState } from "react";
import styles from "./Screens.module.css";

export function ReportsView() {
  const [initial, setInitial] = useState("");
  const [final, setFinal] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className={styles.reports}
      onSubmit={(event) => {
        event.preventDefault();
        if (initial > final) {
          setMessage(
            "A data final deve ser igual ou posterior à data inicial.",
          );
          return;
        }
        setMessage(
          "Opções selecionadas para prévia. A geração, exportação e o envio de relatórios serão implementados na etapa de lógica; nenhum arquivo ou e-mail foi gerado.",
        );
      }}
    >
      <h2>Período</h2>
      <div className={`${styles.card} ${styles.dateFields}`}>
        <label className={styles.field}>
          Data Inicial
          <span className={styles.dateBox}>
            <input
              className={!initial ? styles.emptyDate : undefined}
              type="date"
              required
              value={initial}
              onChange={(event) => {
                setInitial(event.target.value);
                setMessage("");
              }}
            />
            {!initial && (
              <span className={styles.datePlaceholder} aria-hidden="true">
                00/00/0000
              </span>
            )}
          </span>
        </label>
        <label className={styles.field}>
          Data Final
          <span className={styles.dateBox}>
            <input
              className={!final ? styles.emptyDate : undefined}
              type="date"
              required
              min={initial || undefined}
              value={final}
              onChange={(event) => {
                setFinal(event.target.value);
                setMessage("");
              }}
            />
            {!final && (
              <span className={styles.datePlaceholder} aria-hidden="true">
                00/00/0000
              </span>
            )}
          </span>
        </label>
      </div>
      <fieldset className={`${styles.card} ${styles.optionsCard}`}>
        <legend>Tipo de relatório</legend>
        <div className={styles.radioRow}>
          {["Faturamento", "Lucro", "Custos", "Relatório completo"].map(
            (type) => (
              <label key={type}>
                <input type="radio" name="report-type" value={type} required />
                {type}
              </label>
            ),
          )}
        </div>
      </fieldset>
      <fieldset className={`${styles.card} ${styles.optionsCard}`}>
        <legend>Formato</legend>
        <div className={styles.radioRow}>
          {["PDF", "Excel (XLSX)", "Enviar por e-mail"].map((format) => (
            <label key={format}>
              <input
                type="radio"
                name="report-format"
                value={format}
                required
              />
              {format}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" className={styles.primary}>
        Gerar Relatório
      </button>
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
    </form>
  );
}
