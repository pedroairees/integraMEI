"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./Screens.module.css";

const months = [
  "NOV / 2025",
  "DEZ / 2025",
  "JAN / 2026",
  "FEV / 2026",
  "MAR / 2026",
  "ABR / 2026",
  "MAI / 2026",
];

export function SuppliesView() {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("6");
  const [selected, setSelected] = useState(false);
  const [message, setMessage] = useState("");
  const populated = selected && period === "6";

  return (
    <section aria-label="Histórico demonstrativo de insumos">
      <form
        className={styles.productRow}
        onSubmit={(event) => {
          event.preventDefault();
          const matches =
            query.trim().toLocaleLowerCase("pt-BR") === "farinha de trigo";
          setSelected(matches);
          setMessage(
            matches
              ? "Prévia de Farinha de Trigo conforme o Figma; não é uma consulta ao mercado."
              : "Nesta prévia, pesquise Farinha de Trigo para visualizar o exemplo do Figma.",
          );
        }}
      >
        <label htmlFor="supply-product">Produto</label>
        <div className={`${styles.productInput} ${styles.searchBox}`}>
          <input
            id="supply-product"
            className={styles.input}
            placeholder="Pesquise"
            list="supply-examples"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(false);
              setMessage("");
            }}
          />
          <datalist id="supply-examples">
            <option value="Farinha de Trigo" />
          </datalist>
          <button
            type="submit"
            className={styles.searchButton}
            aria-label="Pesquisar insumo"
          >
            <Image
              src="/assets/screens/search.svg"
              alt=""
              width={28}
              height={26}
            />
          </button>
        </div>
        <select
          aria-label="Período do histórico"
          className={`${styles.select} ${styles.period}`}
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        >
          <option value="6">Últimos 6 meses</option>
          <option value="3">Últimos 3 meses</option>
          <option value="12">Últimos 12 meses</option>
        </select>
      </form>
      <figure className={styles.suppliesChart}>
        <h2 className={styles.chartTitle}>
          {populated ? (
            "Farinha de Trigo"
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </h2>
        <h3>Evolução do Preço (R$/kg)</h3>
        <div
          className={styles.chartScroll}
          tabIndex={0}
          aria-label="Gráfico de exemplo; role horizontalmente em telas pequenas"
        >
          <div className={styles.chartAxes}>
            <div className={styles.yAxis} aria-hidden="true">
              {["+8,00", "6,00", "4,00", "2,00"].map((value) => (
                <span key={value}>{value}</span>
              ))}
            </div>
            <div className={styles.plot}>
              {populated ? (
                <Image
                  src="/assets/screens/supplies-chart.png"
                  alt="Evolução ilustrativa do preço de Farinha de Trigo conforme o Figma"
                  width={806}
                  height={113}
                />
              ) : (
                <div
                  className={styles.emptyPlot}
                  aria-label="Gráfico sem dados selecionados"
                />
              )}
            </div>
            <div className={styles.xAxis} aria-hidden="true">
              {months.map((month) => (
                <span key={month}>{month}</span>
              ))}
            </div>
          </div>
        </div>
        <figcaption className={styles.screenReader}>
          Prévia visual.{" "}
          {populated
            ? "Maior preço: R$ 7,80 em janeiro de 2026. Menor preço: R$ 4,28 em novembro de 2025. Preço médio: R$ 6,12."
            : "Selecione o exemplo Farinha de Trigo e o período de seis meses."}
        </figcaption>
      </figure>
      <div className={styles.suppliesCopy}>
        <p>Dados consultados baseado nas procuras realizadas por nossa IA.</p>
        <p>Aqui está um resumo dos valores obtidos:</p>
      </div>
      <div className={styles.summaryGrid}>
        {[
          { title: "Maior Preço", value: "R$ 7,80", date: "(jan/2026)" },
          { title: "Menor Preço", value: "R$ 4,28", date: "(nov/2025)" },
          { title: "Preço médio (período)", value: "R$ 6,12", date: "" },
        ].map((item) => (
          <article
            className={`${styles.card} ${styles.summary}`}
            key={item.title}
          >
            <h3>{item.title}</h3>
            <strong>{populated ? item.value : "R$ 0,00"}</strong>
            {populated && item.date && <small>{item.date}</small>}
          </article>
        ))}
      </div>
      {(message || period !== "6") && (
        <p className={styles.message} role="status">
          {period !== "6"
            ? "Não há dados demonstrativos para este período. O Figma fornece o exemplo de seis meses."
            : message}
        </p>
      )}
    </section>
  );
}
